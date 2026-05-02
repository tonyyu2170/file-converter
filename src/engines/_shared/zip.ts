import type { OutputItem } from "./types";

type ClientZipModule = typeof import("client-zip");

let clientZipModulePromise: Promise<ClientZipModule> | undefined;

async function loadClientZip(): Promise<ClientZipModule> {
  if (!clientZipModulePromise) {
    clientZipModulePromise = import("client-zip");
  }
  return clientZipModulePromise;
}

export async function buildZipBlob(
  items: ReadonlyArray<OutputItem>,
  archiveName: string,
): Promise<{ filename: string; blob: Blob }> {
  if (items.length === 0) {
    throw new Error("buildZipBlob: items is empty");
  }
  const lib = await loadClientZip();
  const entries = items.map((it) => ({ name: it.filename, input: it.blob }));
  const response = lib.downloadZip(entries);
  const blob = await response.blob();
  return { filename: archiveName, blob };
}
