import type { OutputItem } from "@/engines/_shared/types";
import * as Comlink from "comlink";
import { type ArchiveCreateOptions, extensionFor } from "./options";

function basenameOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

function dedupe(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((raw) => {
    const base = basenameOf(raw);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    if (count === 0) return base;
    const dot = base.lastIndexOf(".");
    const stem = dot === -1 ? base : base.slice(0, dot);
    const ext = dot === -1 ? "" : base.slice(dot);
    return `${stem}-${count}${ext}`;
  });
}

type WorkerInput = { bytes: ArrayBuffer; name: string; type: string };

export async function createArchive(
  files: WorkerInput[],
  opts: ArchiveCreateOptions,
): Promise<OutputItem> {
  const entryNames = dedupe(files.map((f) => f.name));
  const ext = extensionFor(opts.outputFormat);
  const filename = `${opts.filename}.${ext}`;

  if (opts.outputFormat === "zip") {
    const { zipSync } = await import("fflate");
    const entries: Record<string, Uint8Array> = {};
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (!f) continue;
      entries[entryNames[i] ?? f.name] = new Uint8Array(f.bytes);
    }
    const zipped = zipSync(entries);
    return {
      filename,
      mime: "application/zip",
      blob: new Blob([zipped.buffer as ArrayBuffer], { type: "application/zip" }),
    };
  }

  // tar.gz
  const { writeTar } = await import("@/engines/_shared/tar");
  const { gzipSync } = await import("fflate");
  const tarBytes = writeTar(
    files.map((f, i) => ({
      path: entryNames[i] ?? f.name,
      size: f.bytes.byteLength,
      mtime: 0,
      type: "file" as const,
      payload: new Uint8Array(f.bytes),
    })),
  );
  const gz = gzipSync(tarBytes, { mtime: 0 });
  return {
    filename,
    mime: "application/gzip",
    blob: new Blob([gz.buffer as ArrayBuffer], { type: "application/gzip" }),
  };
}

const api = {
  async convertMulti(files: WorkerInput[], opts: ArchiveCreateOptions): Promise<OutputItem> {
    return createArchive(files, opts);
  },
};

Comlink.expose(api);
