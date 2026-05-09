export type TarEntry = {
  /** POSIX-style path; forward slashes. Trailing `/` indicates a directory. */
  path: string;
  /** Declared payload bytes. 0 for directories. */
  size: number;
  /** Unix seconds; 0 if unknown. */
  mtime: number;
  type: "file" | "directory";
  /** Empty for directories. */
  payload: Uint8Array;
};

const BLOCK_SIZE = 512;
const TEXT_DECODER = new TextDecoder("utf-8");
const TEXT_ENCODER = new TextEncoder();

const TYPEFLAG_FILE = "0".charCodeAt(0);
const TYPEFLAG_DIRECTORY = "5".charCodeAt(0);
const TYPEFLAG_LONGLINK_GNU = "L".charCodeAt(0);
const TYPEFLAG_PAX_HEADER = "x".charCodeAt(0);
const TYPEFLAG_PAX_GLOBAL = "g".charCodeAt(0);
const TYPEFLAG_SPARSE_GNU = "S".charCodeAt(0);

/** Read POSIX ustar / GNU TAR. Throws on bad checksum / truncation / sparse. */
export function readTar(buf: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  let pendingLongName: string | undefined;

  while (offset + BLOCK_SIZE <= buf.length) {
    const header = buf.subarray(offset, offset + BLOCK_SIZE);

    // Two consecutive zero blocks => end-of-archive.
    if (isZeroBlock(header)) {
      // Don't require a second zero block strictly — some tools omit. The
      // first zero block alone is a strong "end" signal.
      break;
    }

    verifyChecksum(header, offset);

    const typeFlag = header[156] ?? 0;

    if (typeFlag === TYPEFLAG_SPARSE_GNU) {
      throw new Error(
        `_shared/tar: sparse files (typeflag "S") are not supported (at byte ${offset})`,
      );
    }

    const declaredSize = parseOctal(header, 124, 12);
    const payloadStart = offset + BLOCK_SIZE;
    const payloadEnd = payloadStart + declaredSize;
    if (payloadEnd > buf.length) {
      throw new Error(
        `_shared/tar: entry payload truncated (need ${declaredSize} bytes at ${payloadStart}, only ${buf.length - payloadStart} available)`,
      );
    }
    const payload = buf.subarray(payloadStart, payloadEnd);
    const advance = BLOCK_SIZE + roundUp(declaredSize, BLOCK_SIZE);

    if (typeFlag === TYPEFLAG_PAX_HEADER || typeFlag === TYPEFLAG_PAX_GLOBAL) {
      // Consume and ignore PAX records — the next entry takes over.
      offset += advance;
      continue;
    }

    if (typeFlag === TYPEFLAG_LONGLINK_GNU) {
      pendingLongName = trimNul(TEXT_DECODER.decode(payload));
      offset += advance;
      continue;
    }

    const path = pendingLongName ?? readUstarPath(header);
    pendingLongName = undefined;
    const mtime = parseOctal(header, 136, 12);

    const isDirectory = typeFlag === TYPEFLAG_DIRECTORY || path.endsWith("/");
    entries.push({
      path,
      size: declaredSize,
      mtime,
      type: isDirectory ? "directory" : "file",
      payload: isDirectory ? new Uint8Array() : payload,
    });

    offset += advance;
  }

  return entries;
}

/** Write POSIX ustar. Throws on path > 100 bytes (no GNU longname on write). */
export function writeTar(entries: ReadonlyArray<TarEntry>): Uint8Array {
  let totalBytes = 0;
  for (const e of entries) {
    totalBytes += BLOCK_SIZE + roundUp(e.payload.length, BLOCK_SIZE);
  }
  totalBytes += BLOCK_SIZE * 2; // EOF (two zero blocks)

  const out = new Uint8Array(totalBytes);
  let offset = 0;
  for (const e of entries) {
    writeHeader(out, offset, e);
    if (e.type === "file") {
      out.set(e.payload, offset + BLOCK_SIZE);
    }
    offset += BLOCK_SIZE + roundUp(e.payload.length, BLOCK_SIZE);
  }
  // Final two zero blocks already zero-initialised.
  return out;
}

// ─── Internals ─────────────────────────────────────────────────────────────

function isZeroBlock(b: Uint8Array): boolean {
  for (let i = 0; i < b.length; i++) if (b[i] !== 0) return false;
  return true;
}

function verifyChecksum(header: Uint8Array, offsetForError: number): void {
  const declared = parseOctal(header, 148, 8);
  // Sum: replace bytes 148..156 with ASCII spaces (0x20) when computing.
  let sum = 0;
  for (let i = 0; i < BLOCK_SIZE; i++) {
    if (i >= 148 && i < 156) {
      sum += 0x20;
    } else {
      sum += header[i] ?? 0;
    }
  }
  if (sum !== declared) {
    throw new Error(
      `_shared/tar: header checksum mismatch at byte ${offsetForError} (declared ${declared}, computed ${sum})`,
    );
  }
}

function parseOctal(buf: Uint8Array, start: number, len: number): number {
  // ustar octal numeric fields are NUL- or space-terminated.
  let s = "";
  for (let i = 0; i < len; i++) {
    const c = buf[start + i] ?? 0;
    if (c === 0 || c === 0x20) {
      if (s.length > 0) break; // leading whitespace allowed
      continue;
    }
    s += String.fromCharCode(c);
  }
  if (s.length === 0) return 0;
  const n = Number.parseInt(s, 8);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`_shared/tar: invalid octal field "${s}"`);
  }
  return n;
}

function readUstarPath(header: Uint8Array): string {
  const name = trimNul(TEXT_DECODER.decode(header.subarray(0, 100)));
  // ustar prefix field at 345..500
  const magic = TEXT_DECODER.decode(header.subarray(257, 263));
  if (magic === "ustar\0" || magic === "ustar ") {
    const prefix = trimNul(TEXT_DECODER.decode(header.subarray(345, 500)));
    if (prefix.length > 0) return `${prefix}/${name}`;
  }
  return name;
}

function trimNul(s: string): string {
  const i = s.indexOf("\0");
  return i === -1 ? s : s.slice(0, i);
}

function roundUp(n: number, mult: number): number {
  if (n === 0) return 0;
  const r = n % mult;
  return r === 0 ? n : n + (mult - r);
}

function writeHeader(out: Uint8Array, offset: number, e: TarEntry): void {
  const pathBytes = TEXT_ENCODER.encode(e.path);
  if (pathBytes.length > 100) {
    throw new Error(
      `_shared/tar: filename > 100 bytes not supported on write ("${e.path}", ${pathBytes.length} bytes); rename or shorten`,
    );
  }
  out.set(pathBytes, offset); // bytes 0..100 — name

  // mode (octal 0644 / 0755)
  writeOctal(out, offset + 100, 8, e.type === "directory" ? 0o755 : 0o644);
  // uid, gid: 0
  writeOctal(out, offset + 108, 8, 0);
  writeOctal(out, offset + 116, 8, 0);
  // size
  writeOctal(out, offset + 124, 12, e.payload.length);
  // mtime
  writeOctal(out, offset + 136, 12, e.mtime);
  // checksum field: filled with spaces during sum, then written.
  for (let i = 148; i < 156; i++) out[offset + i] = 0x20;
  // typeflag
  out[offset + 156] = e.type === "directory" ? TYPEFLAG_DIRECTORY : TYPEFLAG_FILE;
  // linkname (offset 157..257): zeros
  // ustar magic + version
  out.set(TEXT_ENCODER.encode("ustar\0"), offset + 257);
  out.set(TEXT_ENCODER.encode("00"), offset + 263);
  // uname / gname (zeros are fine for both)
  // devmajor / devminor (zeros)
  writeOctal(out, offset + 329, 8, 0);
  writeOctal(out, offset + 337, 8, 0);
  // prefix (zeros — filenames > 100 bytes already rejected)

  // Compute checksum: 8-bit unsigned sum of all 512 bytes with the checksum
  // field treated as 8 spaces (already in place).
  let sum = 0;
  for (let i = 0; i < BLOCK_SIZE; i++) sum += out[offset + i] ?? 0;
  // Write checksum: 6 octal digits, NUL, space.
  const digits = sum.toString(8).padStart(6, "0");
  for (let i = 0; i < 6; i++) out[offset + 148 + i] = digits.charCodeAt(i);
  out[offset + 154] = 0;
  out[offset + 155] = 0x20;
}

function writeOctal(out: Uint8Array, start: number, len: number, value: number): void {
  // ustar octal fields are NUL-terminated (or space-padded). Convention:
  // (len-1) digits + NUL terminator.
  const digits = value.toString(8).padStart(len - 1, "0");
  for (let i = 0; i < len - 1; i++) out[start + i] = digits.charCodeAt(i);
  out[start + len - 1] = 0;
}
