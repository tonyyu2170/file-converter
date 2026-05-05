"use client";

import type {
  EngineLicense,
  OptionsPanelProps,
  OutputItem,
  SingleInputEngine,
  ValidationResult,
} from "@/engines/_shared/types";
import * as Comlink from "comlink";
import { type ComponentType, useCallback, useEffect, useRef, useState } from "react";
import { editedFilename } from "./filenames";
import { type PdfEditOptions, defaultPdfEditOptions, seedFromPageCount } from "./options";
import { PdfEditOptionsPanel } from "./options-panel";
import type { EncryptedError, PdfEditWorkerApi } from "./worker";

const SUPPORTED_MIMES = ["application/pdf"];
const MAX_BYTES_HARD = 250 * 1_000_000; // §11.1 PDF hard cap
const MAX_PAGES_HARD = 250;

function makeWorker(): Worker {
  return new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
  });
}

// Module-level singleton: the worker that holds the parsed file. Created
// when the engine sees a fresh file (validate time). The OptionsPanel
// host reads from this same worker; Convert reuses it.
let activeWorker: Worker | null = null;
let activeApi: Comlink.Remote<PdfEditWorkerApi> | null = null;
let activeFileKey: string | null = null;

async function loadFileIntoWorker(file: File): Promise<{ pageCount: number }> {
  const key = `${file.name}:${file.size}:${file.lastModified}`;
  if (key === activeFileKey && activeApi) {
    // Already loaded this exact file — re-use the existing worker.
    const buf = await file.arrayBuffer();
    return await activeApi.load(buf);
  }
  // Replace active worker.
  if (activeWorker) {
    try {
      await activeApi?.dispose();
    } catch {
      /* ignore */
    }
    activeWorker.terminate();
  }
  activeWorker = makeWorker();
  activeApi = Comlink.wrap<PdfEditWorkerApi>(activeWorker);
  activeFileKey = key;
  const buf = await file.arrayBuffer();
  return await activeApi.load(buf);
}

function disposeActive(): void {
  if (activeApi) {
    activeApi.dispose().catch(() => {});
  }
  activeWorker?.terminate();
  activeWorker = null;
  activeApi = null;
  activeFileKey = null;
}

/**
 * Wrapper component that owns the per-mount worker instance and the
 * thumbnail map. Mediates between PdfEditOptionsPanel (presentational)
 * and the Comlink-wrapped worker. Used as the engine's OptionsPanel.
 *
 * The host opportunistically points at the module-scoped activeApi so
 * that thumbnails become available after convert() has pre-loaded the
 * file. A clean fix would require the harness to pass the staged File
 * to the OptionsPanel — deferred for a future harness lifecycle seam.
 */
const PdfEditOptionsPanelHost: ComponentType<OptionsPanelProps<PdfEditOptions>> = ({
  value,
  onChange,
}) => {
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});
  const workerRef = useRef<Worker | null>(null);
  const apiRef = useRef<Comlink.Remote<PdfEditWorkerApi> | null>(null);
  // Avoid re-requesting the same page if it's already pending.
  const requestedRef = useRef<Set<number>>(new Set());

  // Tear down on unmount: revoke object URLs, dispose worker.
  // biome-ignore lint/correctness/useExhaustiveDependencies: cleanup runs once on unmount
  useEffect(() => {
    return () => {
      apiRef.current?.dispose();
      workerRef.current?.terminate();
      workerRef.current = null;
      apiRef.current = null;
      for (const url of Object.values(thumbnails)) URL.revokeObjectURL(url);
    };
  }, []);

  const requestThumbnail = useCallback(async (sourceIndex: number) => {
    if (requestedRef.current.has(sourceIndex)) return;
    // FIXME(pdf-edit): apiRef is never populated by this component because
    // the harness doesn't pass the staged File to the OptionsPanel. The
    // opportunistic fallback below picks up activeApi once convert() has
    // called loadFileIntoWorker, so thumbnails appear only post-Convert.
    // A clean fix requires a harness lifecycle seam (prepare/stage hook).
    if (!apiRef.current && activeApi) apiRef.current = activeApi;
    if (!apiRef.current) return;
    requestedRef.current.add(sourceIndex);
    try {
      const blob = await apiRef.current.renderPage(sourceIndex, 240);
      const url = URL.createObjectURL(blob);
      setThumbnails((prev) => ({ ...prev, [sourceIndex]: url }));
    } catch {
      // Thumbnail failure is non-fatal; cell stays with the placeholder.
      requestedRef.current.delete(sourceIndex);
    }
  }, []);

  return (
    <PdfEditOptionsPanel
      value={value}
      onChange={onChange}
      thumbnails={thumbnails}
      onRequestThumbnail={requestThumbnail}
    />
  );
};

const engine: SingleInputEngine<PdfEditOptions, OutputItem> = {
  id: "pdf-edit",
  inputAccept: [".pdf"],
  inputMime: SUPPORTED_MIMES,
  outputMime: "application/pdf",
  defaultOptions: defaultPdfEditOptions,
  category: "pdf",
  library: "pdf-lib, pdfjs-dist",
  license: "mixed" as EngineLicense,
  cardinality: "single",
  OptionsPanel: PdfEditOptionsPanelHost,

  validate(file): ValidationResult {
    const mimeOk = SUPPORTED_MIMES.includes(file.type);
    const extOk = /\.pdf$/i.test(file.name);
    if (!mimeOk && !extOk) return { ok: false, reason: "Expected a PDF file" };
    if (file.size === 0) return { ok: false, reason: "File is empty" };
    if (file.size > MAX_BYTES_HARD) {
      return {
        ok: false,
        reason: `File too large for pdf-edit (limit 250 MB; got ${(file.size / 1_000_000).toFixed(1)} MB)`,
      };
    }
    return { ok: true };
  },

  async convert(file, opts, signal, _runOpts): Promise<OutputItem> {
    if (signal.aborted) throw new DOMException("aborted", "AbortError");

    let workingOpts = opts;
    if (workingOpts.pages.length === 0) {
      // No edits were applied (user clicked Convert immediately); load and
      // pass through with rotation 0 / original order / no deletes.
      let pageCount: number;
      try {
        ({ pageCount } = await loadFileIntoWorker(file));
      } catch (err: unknown) {
        if ((err as EncryptedError | undefined)?.kind === "encrypted") {
          throw new Error("Encrypted PDFs aren't supported");
        }
        throw err;
      }
      if (pageCount > MAX_PAGES_HARD) {
        throw new Error(`Too many pages (${pageCount} > ${MAX_PAGES_HARD}) — split first`);
      }
      workingOpts = seedFromPageCount(pageCount);
    }

    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    if (!activeApi) await loadFileIntoWorker(file);
    if (!activeApi) throw new Error("pdf-edit: worker failed to initialise");

    const bytes = await activeApi.apply(workingOpts);
    const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
    return {
      filename: editedFilename(file.name),
      mime: "application/pdf",
      blob,
    };
  },

  isReadyToConvert(opts) {
    // If pages haven't been seeded yet (file just dropped), Convert is
    // still ready — convert() will seed from the file. If pages have been
    // seeded, require at least one page remaining.
    if (opts.totalSourcePages === 0) return true;
    return opts.pages.length > 0;
  },
};

export { disposeActive as __disposeActiveWorkerForTest };
export default engine;
