#!/usr/bin/env node
/**
 * Deterministic archive fixture generator.
 *
 * Run from repo root: node tests/fixtures/scripts/generate-archive-fixtures.mjs
 *
 * Produces all fixtures under tests/fixtures/archives/. Idempotent —
 * re-running overwrites existing files with byte-identical output (mtime is
 * pinned to FIXED_MTIME below; gzip is invoked with no timestamp).
 *
 * The TAR helpers in this script are intentionally INDEPENDENT of
 * src/engines/_shared/tar/ so the readTar tests verify against bytes that
 * weren't produced by writeTar.
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "fflate";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT = path.join(ROOT, "tests/fixtures/archives");
mkdirSync(OUT, { recursive: true });

const FIXED_MTIME = 0; // pin for byte-stable output
const enc = new TextEncoder();

function readBuf(p) { return new Uint8Array(readFileSync(p)); }

// ── Independent minimal TAR writer (NOT _shared/tar). ──────────────────────
// Used to build tar-sparse.tar header and the round-trip fixtures' inner tars.
function buildTarHeader({ path: p, size, mtime, typeflag }) {
  const block = new Uint8Array(512);
  const nameBytes = enc.encode(p);
  if (nameBytes.length > 100) throw new Error(`fixture name too long: ${p}`);
  block.set(nameBytes, 0);
  writeOctal(block, 100, 8, 0o644); // mode
  writeOctal(block, 108, 8, 0); // uid
  writeOctal(block, 116, 8, 0); // gid
  writeOctal(block, 124, 12, size);
  writeOctal(block, 136, 12, mtime);
  for (let i = 148; i < 156; i++) block[i] = 0x20; // checksum spaces
  block[156] = typeflag;
  // POSIX ustar: magic = "ustar\0" at 257..263, version "00" at 263..265.
  block.set(enc.encode("ustar"), 257);
  // 263 is already 0 (NUL), so magic field ends correctly.
  block.set(enc.encode("00"), 263);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += block[i];
  const digits = sum.toString(8).padStart(6, "0");
  for (let i = 0; i < 6; i++) block[148 + i] = digits.charCodeAt(i);
  block[154] = 0;
  block[155] = 0x20;
  return block;
}
function writeOctal(buf, start, len, value) {
  const digits = value.toString(8).padStart(len - 1, "0");
  for (let i = 0; i < len - 1; i++) buf[start + i] = digits.charCodeAt(i);
  buf[start + len - 1] = 0;
}
function buildTar(entries) {
  const blocks = [];
  for (const e of entries) {
    blocks.push(buildTarHeader({
      path: e.path,
      size: e.payload.length,
      mtime: FIXED_MTIME,
      typeflag: 0x30, // "0"
    }));
    blocks.push(e.payload);
    const pad = (512 - (e.payload.length % 512)) % 512;
    if (pad) blocks.push(new Uint8Array(pad));
  }
  blocks.push(new Uint8Array(1024)); // EOF
  return concat(blocks);
}
function concat(arrs) {
  const total = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

// ── Happy-path fixtures ────────────────────────────────────────────────────

const HELLO = enc.encode("hello\n");
const NOTES = enc.encode("# notes\n");

const sampleTar = buildTar([
  { path: "hello.txt", payload: HELLO },
  { path: "data/notes.md", payload: NOTES },
]);
writeFileSync(path.join(OUT, "sample.tar"), sampleTar);
console.log("✓ sample.tar");

writeFileSync(path.join(OUT, "sample.tar.gz"), gzipSync(sampleTar, { mtime: 0 }));
console.log("✓ sample.tar.gz");

writeFileSync(path.join(OUT, "sample.zip"), buildStoredZip([
  { name: "hello.txt", data: HELLO },
  { name: "data/notes.md", data: NOTES },
]));
console.log("✓ sample.zip");

// ── Security fixtures ──────────────────────────────────────────────────────

writeFileSync(path.join(OUT, "zip-slip.zip"), buildStoredZip([
  { name: "../escape.txt", data: enc.encode("escaped\n") },
]));
console.log("✓ zip-slip.zip");

writeFileSync(path.join(OUT, "huge-entry.zip"), buildForgedSizeZip({
  name: "huge.bin",
  declaredUncompressed: 2_000_000_000,
  realPayload: enc.encode("forged-uncompressed-size-sentinel"),
}));
console.log("✓ huge-entry.zip");

const bombEntries = [];
for (let i = 0; i < 100; i++) {
  bombEntries.push({ name: `entry-${i}.bin`, declaredUncompressed: 50_000_000 });
}
writeFileSync(path.join(OUT, "bomb.zip"), buildBombZip(bombEntries));
console.log("✓ bomb.zip");

writeFileSync(path.join(OUT, "bare.gz"), gzipSync(HELLO, { mtime: 0 }));
console.log("✓ bare.gz");

try {
  const tmp = path.join(OUT, "_tmp-encrypted-source.txt");
  writeFileSync(tmp, "secret\n");
  execSync(`cd "${OUT}" && rm -f encrypted.zip && zip -j -q -P test encrypted.zip _tmp-encrypted-source.txt`);
  execSync(`rm "${tmp}"`);
  console.log("✓ encrypted.zip (via zip -P)");
} catch (err) {
  console.warn(`! skipped encrypted.zip — install Info-ZIP \`zip\` and re-run (${err.message})`);
}

// ── TAR-format fixtures ────────────────────────────────────────────────────

try {
  const tmpDir = path.join(OUT, "_tmp-tar-src");
  execSync(`rm -rf "${tmpDir}" && mkdir -p "${tmpDir}/data"`);
  writeFileSync(path.join(tmpDir, "hello.txt"), HELLO);
  writeFileSync(path.join(tmpDir, "data/notes.md"), NOTES);
  // BSD tar (macOS): no --mtime flag; we accept the live mtime for
  // tar-cli-sample.tar. Determinism for that file is not required since the
  // checksum-and-truncation tests only assert *behavior*, not byte equality.
  const cmd = process.platform === "darwin"
    ? `cd "${tmpDir}" && COPYFILE_DISABLE=1 tar -cf "${path.join(OUT, "tar-cli-sample.tar")}" hello.txt data/notes.md`
    : `cd "${tmpDir}" && tar --mtime='1970-01-01' --owner=0 --group=0 --numeric-owner -cf "${path.join(OUT, "tar-cli-sample.tar")}" hello.txt data/notes.md`;
  execSync(cmd);
  execSync(`rm -rf "${tmpDir}"`);
  console.log("✓ tar-cli-sample.tar");
} catch (err) {
  console.warn(`! skipped tar-cli-sample.tar — install tar and re-run (${err.message})`);
}

try {
  const buf = readBuf(path.join(OUT, "tar-cli-sample.tar"));
  const corrupted = new Uint8Array(buf);
  corrupted[0] = corrupted[0] === 0x61 ? 0x62 : 0x61;
  writeFileSync(path.join(OUT, "tar-bad-checksum.tar"), corrupted);
  console.log("✓ tar-bad-checksum.tar");
} catch {
  console.warn("! skipped tar-bad-checksum.tar (depends on tar-cli-sample.tar)");
}

try {
  const buf = readBuf(path.join(OUT, "tar-cli-sample.tar"));
  // Slice at 515: header (512) + 3 bytes of payload. First entry is hello.txt
  // (size=6), so payloadEnd=518 > 515 — guaranteed truncation regardless of
  // whether BSD tar emits PAX headers (original spec used 512+50 which was
  // designed for PAX-prefixed output that pushes data further; plain ustar
  // with a 6-byte first entry fits entirely within 512+50 bytes).
  writeFileSync(path.join(OUT, "tar-truncated.tar"), buf.slice(0, 515));
  console.log("✓ tar-truncated.tar");
} catch {
  console.warn("! skipped tar-truncated.tar (depends on tar-cli-sample.tar)");
}

{
  const header = buildTarHeader({
    path: "sparse.bin",
    size: 100,
    mtime: 0,
    typeflag: 0x53, // "S"
  });
  writeFileSync(path.join(OUT, "tar-sparse.tar"), concat([header, new Uint8Array(512), new Uint8Array(1024)]));
  console.log("✓ tar-sparse.tar");
}

console.log("\nAll fixtures written to tests/fixtures/archives/");

// ── Helpers ────────────────────────────────────────────────────────────────

// Minimal STORED-only ZIP writer. Stable byte output (no deflate randomness).
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function buildStoredZip(entries) {
  const localBlocks = [];
  const centralBlocks = [];
  let offset = 0;
  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const c = crc32(e.data);
    const local = new Uint8Array(30 + nameBytes.length + e.data.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 0, true);
    dv.setUint16(8, 0, true);
    dv.setUint16(10, 0, true);
    dv.setUint16(12, 0, true);
    dv.setUint32(14, c, true);
    dv.setUint32(18, e.data.length, true);
    dv.setUint32(22, e.data.length, true);
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    local.set(e.data, 30 + nameBytes.length);
    localBlocks.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(central.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 20, true);
    cdv.setUint16(6, 20, true);
    cdv.setUint16(8, 0, true);
    cdv.setUint16(10, 0, true);
    cdv.setUint16(12, 0, true);
    cdv.setUint16(14, 0, true);
    cdv.setUint32(16, c, true);
    cdv.setUint32(20, e.data.length, true);
    cdv.setUint32(24, e.data.length, true);
    cdv.setUint16(28, nameBytes.length, true);
    cdv.setUint16(30, 0, true);
    cdv.setUint16(32, 0, true);
    cdv.setUint16(34, 0, true);
    cdv.setUint16(36, 0, true);
    cdv.setUint32(38, 0, true);
    cdv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralBlocks.push(central);
    offset += local.length;
  }
  const central = concat(centralBlocks);
  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(4, 0, true); edv.setUint16(6, 0, true);
  edv.setUint16(8, entries.length, true);
  edv.setUint16(10, entries.length, true);
  edv.setUint32(12, central.length, true);
  edv.setUint32(16, offset, true);
  edv.setUint16(20, 0, true);
  return concat([...localBlocks, central, eocd]);
}
function buildForgedSizeZip({ name, declaredUncompressed, realPayload }) {
  const buf = buildStoredZip([{ name, data: realPayload }]);
  const dv = new DataView(buf.buffer);
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocdOffset = i; break; }
  }
  if (eocdOffset < 0) throw new Error("EOCD not found");
  const cdOffset = dv.getUint32(eocdOffset + 16, true);
  dv.setUint32(cdOffset + 24, declaredUncompressed >>> 0, true);
  return buf;
}
function buildBombZip(entries) {
  const realPayload = enc.encode("x");
  const buf = buildStoredZip(entries.map((e) => ({ name: e.name, data: realPayload })));
  const dv = new DataView(buf.buffer);
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocdOffset = i; break; }
  }
  let cdOffset = dv.getUint32(eocdOffset + 16, true);
  for (const e of entries) {
    dv.setUint32(cdOffset + 24, e.declaredUncompressed >>> 0, true);
    const nameLen = dv.getUint16(cdOffset + 28, true);
    const extraLen = dv.getUint16(cdOffset + 30, true);
    const commentLen = dv.getUint16(cdOffset + 32, true);
    cdOffset += 46 + nameLen + extraLen + commentLen;
  }
  return buf;
}
