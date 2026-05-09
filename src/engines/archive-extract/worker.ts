import type { OutputItem } from "@/engines/_shared/types";
import * as Comlink from "comlink";
import { type Unzipped, gunzipSync, unzipSync } from "fflate";
import type { ArchiveExtractOptions } from "./options";

const PER_ENTRY_BYTES_CAP = 1 * 1024 * 1024 * 1024; // 1 GB
const TOTAL_BYTES_CAP = 2 * 1024 * 1024 * 1024; // 2 GB

type Format = "zip" | "tar" | "tar.gz";

function detectFormat(bytes: Uint8Array): Format {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    // PK\x03\x04 (local file header) or PK\x05\x06 (empty archive EOCD)
    if (bytes[2] === 0x03 && bytes[3] === 0x04) return "zip";
    if (bytes[2] === 0x05 && bytes[3] === 0x06) return "zip";
  }
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return "tar.gz";
  }
  // ustar magic at offset 257
  if (bytes.length >= 263) {
    const magic = String.fromCharCode(...bytes.subarray(257, 263));
    // Accept both POSIX (`ustar\0`) and old GNU (`ustar `) forms; the magic
    // check just needs to confirm it's a TAR before we go any deeper.
    if (magic.startsWith("ustar")) return "tar";
  }
  throw new Error("archive-extract: unrecognized archive format");
}

function isSafePath(p: string): boolean {
  if (p.length === 0) return false;
  if (p.startsWith("/")) return false;
  if (/^[A-Za-z]:/.test(p)) return false; // Windows drive letter
  if (p.includes("\0")) return false;
  // Disallow any segment that is exactly ".."
  for (const seg of p.split("/")) {
    if (seg === "..") return false;
  }
  return true;
}

async function extractZip(bytes: Uint8Array): Promise<OutputItem[]> {
  // Pre-flight: parse the central directory ourselves to enumerate entries
  // with declared sizes + encryption bit + path safety, BEFORE allocating
  // uncompressed buffers via fflate.
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Locate EOCD by scanning back from the end (max 22 + 65535 bytes per ZIP spec).
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("archive-extract: ZIP end-of-central-directory not found");
  const cdSize = dv.getUint32(eocdOffset + 12, true);
  const cdStart = dv.getUint32(eocdOffset + 16, true);
  if (cdStart + cdSize > bytes.length) {
    throw new Error("archive-extract: ZIP central directory truncated");
  }

  let cursor = cdStart;
  const cdEnd = cdStart + cdSize;
  const entries: Array<{ path: string; uncompressed: number }> = [];
  let total = 0;
  while (cursor + 46 <= cdEnd) {
    if (dv.getUint32(cursor, true) !== 0x02014b50) {
      throw new Error("archive-extract: malformed ZIP central directory");
    }
    const gpFlag = dv.getUint16(cursor + 8, true);
    if (gpFlag & 0x0001) {
      throw new Error(
        "archive-extract: this archive is encrypted; password-protected ZIPs aren't supported",
      );
    }
    const uncompressed = dv.getUint32(cursor + 24, true);
    const nameLen = dv.getUint16(cursor + 28, true);
    const extraLen = dv.getUint16(cursor + 30, true);
    const commentLen = dv.getUint16(cursor + 32, true);
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLen);
    const entryPath = new TextDecoder("utf-8").decode(nameBytes);

    if (!isSafePath(entryPath)) {
      throw new Error(
        `archive-extract: archive contains entry with unsafe path: \`${entryPath}\`; refusing to extract`,
      );
    }
    if (uncompressed > PER_ENTRY_BYTES_CAP) {
      throw new Error(
        `archive-extract: entry \`${entryPath}\` would expand to ${(uncompressed / 1_000_000_000).toFixed(2)} GB; refusing to extract`,
      );
    }
    total += uncompressed;
    if (total > TOTAL_BYTES_CAP) {
      throw new Error(
        `archive-extract: archive would expand to ${(total / 1_000_000_000).toFixed(2)} GB total; refusing to extract`,
      );
    }
    entries.push({ path: entryPath, uncompressed });
    cursor += 46 + nameLen + extraLen + commentLen;
  }

  // Pre-flight passed → decompress.
  const unzipped: Unzipped = unzipSync(bytes);
  const outputs: OutputItem[] = [];
  for (const e of entries) {
    if (e.path.endsWith("/") && e.uncompressed === 0) continue; // directory entry
    const data = unzipped[e.path];
    if (!data) continue; // shouldn't happen — central dir said it's there
    outputs.push({
      filename: e.path,
      mime: "application/octet-stream",
      blob: new Blob([data as Uint8Array<ArrayBuffer>], { type: "application/octet-stream" }),
    });
  }
  return outputs;
}

async function extractTar(bytes: Uint8Array): Promise<OutputItem[]> {
  const { readTar } = await import("@/engines/_shared/tar");
  const entries = readTar(bytes);
  let total = 0;
  for (const e of entries) {
    if (e.type !== "file") continue;
    if (!isSafePath(e.path)) {
      throw new Error(
        `archive-extract: archive contains entry with unsafe path: \`${e.path}\`; refusing to extract`,
      );
    }
    if (e.size > PER_ENTRY_BYTES_CAP) {
      throw new Error(
        `archive-extract: entry \`${e.path}\` would expand to ${(e.size / 1_000_000_000).toFixed(2)} GB; refusing to extract`,
      );
    }
    total += e.size;
    if (total > TOTAL_BYTES_CAP) {
      throw new Error(
        `archive-extract: archive would expand to ${(total / 1_000_000_000).toFixed(2)} GB total; refusing to extract`,
      );
    }
  }
  return entries
    .filter((e) => e.type === "file")
    .map((e) => ({
      filename: e.path,
      mime: "application/octet-stream",
      blob: new Blob([e.payload as Uint8Array<ArrayBuffer>], { type: "application/octet-stream" }),
    }));
}

async function extractTarGz(bytes: Uint8Array): Promise<OutputItem[]> {
  // Bounded gunzip: read the gzip footer's uncompressed-size field BEFORE
  // calling gunzipSync (which allocates output up-front based on that size).
  // RFC 1952: last 4 bytes of a gzip stream are ISIZE, the uncompressed size
  // mod 2^32, little-endian. For files > 4 GB the field wraps; the inner TAR
  // scan's TOTAL_BYTES_CAP is the ultimate guard for that pathological case.
  if (bytes.length < 8) {
    throw new Error("archive-extract: gzip stream too short");
  }
  const isizeView = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 4, 4);
  const declaredSize = isizeView.getUint32(0, true);
  if (declaredSize > TOTAL_BYTES_CAP) {
    throw new Error(
      `archive-extract: archive would expand to ${(declaredSize / 1_000_000_000).toFixed(2)} GB total; refusing to extract`,
    );
  }
  let inner: Uint8Array;
  try {
    inner = gunzipSync(bytes);
  } catch (err) {
    throw new Error(`archive-extract: gunzip failed (${err instanceof Error ? err.message : err})`);
  }
  if (inner.length > TOTAL_BYTES_CAP) {
    throw new Error(
      `archive-extract: archive would expand to ${(inner.length / 1_000_000_000).toFixed(2)} GB total; refusing to extract`,
    );
  }
  // Verify the inner stream is actually TAR — magic at offset 257.
  if (inner.length < 263) {
    throw new Error(
      "archive-extract: GZIP of non-TAR not supported in v2; standalone gunzip is on the roadmap",
    );
  }
  const innerMagic = String.fromCharCode(...inner.subarray(257, 263));
  if (!innerMagic.startsWith("ustar")) {
    throw new Error(
      "archive-extract: GZIP of non-TAR not supported in v2; standalone gunzip is on the roadmap",
    );
  }
  return extractTar(inner);
}

/** Pure entry point used by tests. The Comlink-exposed `convertSingle` below
 *  is just an adapter to this function. */
export async function extractArchive(
  fileBytes: ArrayBuffer,
  _fileName: string,
  _fileType: string,
): Promise<OutputItem[]> {
  const bytes = new Uint8Array(fileBytes);
  const fmt = detectFormat(bytes);
  switch (fmt) {
    case "zip":
      return extractZip(bytes);
    case "tar":
      return extractTar(bytes);
    case "tar.gz":
      return extractTarGz(bytes);
  }
}

const api = {
  async convertSingle(
    fileBytes: ArrayBuffer,
    fileName: string,
    fileType: string,
    _opts: ArchiveExtractOptions,
  ): Promise<OutputItem[]> {
    return extractArchive(fileBytes, fileName, fileType);
  },
};

Comlink.expose(api);
