import * as Comlink from "comlink";
import type { ConversionProgress, OutputItem } from "./types";

// Re-exported so existing consumers that import ConversionProgress from
// _shared/harness continue to work after the type moved to _shared/types.
export type { ConversionProgress } from "./types";

export type WorkerEntry<TOptions> = {
  convertSingle?: (
    fileBytes: ArrayBuffer,
    fileName: string,
    fileType: string,
    opts: TOptions,
    /** Optional Comlink-proxied progress callback. Workers that don't emit
     * progress simply never call it. */
    onProgress?: (p: ConversionProgress) => void,
  ) => Promise<OutputItem | OutputItem[]>;
  convertMulti?: (
    files: Array<{ bytes: ArrayBuffer; name: string; type: string }>,
    opts: TOptions,
    onProgress?: (p: ConversionProgress) => void,
  ) => Promise<OutputItem | OutputItem[]>;
  /** Optional: extract waveform peaks for trim-scrubber engines. The trim
   * engines call this RPC from their OptionsPanel via WorkerHarness.runDecodePeaks
   * so peak decoding shares the same persistent worker (and ffmpeg singleton)
   * as the conversion that will follow. */
  decodePeaks?: (
    bytes: ArrayBuffer,
    fileExtension: string,
    bucketCount: number,
  ) => Promise<{ min: Float32Array; max: Float32Array }>;
  /** Optional: probe a media file's codec / duration / dimensions.
   * Engine workers that need codec-aware behavior implement this. The
   * trim-scrubber video branch and video-trim's options-panel both
   * call WorkerHarness.runProbe → this RPC so probe results share the
   * same persistent worker (and ffmpeg singleton) as the conversion. */
  probe?: (
    bytes: ArrayBuffer,
    fileExtension: string,
  ) => Promise<{
    durationSec: number;
    videoCodec: string | null;
    audioCodec: string | null;
    width: number;
    height: number;
    hasAudio: boolean;
  }>;
  /** Optional: extract N evenly-spaced frame thumbnails for the
   * trim-scrubber video render path. Returns raw JPEG bytes; the main-
   * thread harness wraps each into a Blob + object URL. */
  extractFrameStrip?: (args: {
    bytes: ArrayBuffer;
    fileExtension: string;
    durationSec: number;
    sourceWidth: number;
    sourceHeight: number;
    count: number;
    heightPx: number;
  }) => Promise<{
    frames: Uint8Array[];
    widthPx: number;
  }>;
};

export type WorkerFactory = () => Worker;

export type WorkerHarnessOptions = {
  /** When true, the harness keeps the worker alive across runSingle/runMulti
   * calls. Caller is responsible for calling dispose() (typically from a
   * page-level useEffect cleanup). Off by default for backward compatibility. */
  persistent?: boolean;
};

export type RunOptions = {
  /** Host-side callback the harness wraps with Comlink.proxy() before passing
   * it to the worker. Workers invoke it to emit ConversionProgress events;
   * the harness invokes the host callback synchronously on each event. */
  onProgress?: (p: ConversionProgress) => void;
};

// Comlink's Remote<T> rewrites function-argument types via the internal
// UnproxyOrClone<T> mapper, which a generic TOptions cannot satisfy
// without a cast. SingleFn / MultiFn are concrete callable shapes used
// at the call sites after a runtime truthiness guard.
type SingleFn<TOptions> = (
  fileBytes: ArrayBuffer,
  fileName: string,
  fileType: string,
  opts: TOptions,
  onProgress?: (p: ConversionProgress) => void,
) => Promise<OutputItem | OutputItem[]>;

type MultiFn<TOptions> = (
  files: Array<{ bytes: ArrayBuffer; name: string; type: string }>,
  opts: TOptions,
  onProgress?: (p: ConversionProgress) => void,
) => Promise<OutputItem | OutputItem[]>;

export class WorkerHarness<TOptions> {
  private worker: Worker | null = null;
  private remote: Comlink.Remote<WorkerEntry<TOptions>> | null = null;
  // Pending in-flight runSingle/runMulti rejecters. dispose() walks this set
  // rejecting each one with AbortError so callers don't hang on a terminated
  // worker that will never reply. Entries are added when the abortPromise is
  // constructed and removed in the finally block of the corresponding run.
  private pendingRejecters = new Set<(reason: unknown) => void>();

  constructor(
    private readonly factory: WorkerFactory,
    private readonly opts: WorkerHarnessOptions = {},
  ) {}

  async runSingle(
    file: File,
    opts: TOptions,
    signal: AbortSignal,
    runOpts: RunOptions = {},
  ): Promise<OutputItem | OutputItem[]> {
    this.spawn();
    if (!this.remote?.convertSingle) {
      this.terminateIfEphemeral();
      throw new Error("worker does not implement convertSingle");
    }
    // Cast to the concrete callable type — the guard above proves
    // convertSingle is set; Comlink's Remote<T> rewrites function-argument
    // types via UnproxyOrClone<T>, which a generic TOptions cannot satisfy
    // without an explicit cast.
    const convertSingle = this.remote.convertSingle as unknown as SingleFn<TOptions>;
    // Construct the abortPromise and register the rejecter eagerly — before
    // any await — so dispose() / signal.abort() can interrupt at any point,
    // including while file.arrayBuffer() is still pending. Lift `reject` out
    // of the constructor so the finally block can remove it from
    // pendingRejecters on every exit path.
    let rejectAbort!: (reason: unknown) => void;
    const abortPromise = new Promise<never>((_, reject) => {
      rejectAbort = reject;
      if (signal.aborted) {
        this.terminateIfEphemeral();
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      const onAbort = () => {
        this.terminateIfEphemeral();
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
    this.pendingRejecters.add(rejectAbort);
    try {
      const buf = await Promise.race([file.arrayBuffer(), abortPromise]);
      const proxiedOnProgress = runOpts.onProgress ? Comlink.proxy(runOpts.onProgress) : undefined;
      const result = await Promise.race([
        convertSingle(buf, file.name, file.type, opts, proxiedOnProgress),
        abortPromise,
      ]);
      return result;
    } finally {
      this.pendingRejecters.delete(rejectAbort);
      this.terminateIfEphemeral();
    }
  }

  async runMulti(
    files: File[],
    opts: TOptions,
    signal: AbortSignal,
    runOpts: RunOptions = {},
  ): Promise<OutputItem | OutputItem[]> {
    this.spawn();
    if (!this.remote?.convertMulti) {
      this.terminateIfEphemeral();
      throw new Error("worker does not implement convertMulti");
    }
    // Cast to the concrete callable type — same reason as in runSingle.
    const convertMulti = this.remote.convertMulti as unknown as MultiFn<TOptions>;
    // Eager rejecter registration — see runSingle for the rationale.
    let rejectAbort!: (reason: unknown) => void;
    const abortPromise = new Promise<never>((_, reject) => {
      rejectAbort = reject;
      if (signal.aborted) {
        this.terminateIfEphemeral();
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      const onAbort = () => {
        this.terminateIfEphemeral();
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
    this.pendingRejecters.add(rejectAbort);
    try {
      const payload = await Promise.race([
        Promise.all(
          files.map(async (f) => ({ bytes: await f.arrayBuffer(), name: f.name, type: f.type })),
        ),
        abortPromise,
      ]);
      const proxiedOnProgress = runOpts.onProgress ? Comlink.proxy(runOpts.onProgress) : undefined;
      const result = await Promise.race([
        convertMulti(payload, opts, proxiedOnProgress),
        abortPromise,
      ]);
      return result;
    } finally {
      this.pendingRejecters.delete(rejectAbort);
      this.terminateIfEphemeral();
    }
  }

  async runDecodePeaks(
    file: File,
    bucketCount: number,
  ): Promise<{ min: Float32Array; max: Float32Array }> {
    this.spawn();
    if (!this.remote?.decodePeaks) {
      this.terminateIfEphemeral();
      throw new Error("worker does not implement decodePeaks");
    }
    const decodePeaks = this.remote.decodePeaks as unknown as (
      bytes: ArrayBuffer,
      fileExtension: string,
      bucketCount: number,
    ) => Promise<{ min: Float32Array; max: Float32Array }>;
    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    try {
      const bytes = await file.arrayBuffer();
      return await decodePeaks(bytes, ext, bucketCount);
    } finally {
      this.terminateIfEphemeral();
    }
  }

  // Per-File cache for probe results. Keyed on File identity — re-staged
  // files produce a new File object and thus re-probe (correct).
  private probeCache = new WeakMap<
    File,
    Promise<{
      durationSec: number;
      videoCodec: string | null;
      audioCodec: string | null;
      width: number;
      height: number;
      hasAudio: boolean;
    }>
  >();

  async runProbe(file: File): Promise<{
    durationSec: number;
    videoCodec: string | null;
    audioCodec: string | null;
    width: number;
    height: number;
    hasAudio: boolean;
  }> {
    const cached = this.probeCache.get(file);
    if (cached) return cached;
    const promise = (async () => {
      this.spawn();
      if (!this.remote?.probe) {
        this.terminateIfEphemeral();
        throw new Error("worker does not implement probe");
      }
      const probe = this.remote.probe as unknown as (
        bytes: ArrayBuffer,
        ext: string,
      ) => Promise<{
        durationSec: number;
        videoCodec: string | null;
        audioCodec: string | null;
        width: number;
        height: number;
        hasAudio: boolean;
      }>;
      const ext = (file.name.split(".").pop() ?? "").toLowerCase();
      try {
        const bytes = await file.arrayBuffer();
        return await probe(bytes, `.${ext}`);
      } finally {
        this.terminateIfEphemeral();
      }
    })().catch((err) => {
      // On failure, evict the cache so the next call retries.
      this.probeCache.delete(file);
      throw err;
    });
    this.probeCache.set(file, promise);
    return promise;
  }

  async runExtractFrameStrip(args: {
    file: File;
    count: number;
    heightPx: number;
  }): Promise<{ urls: string[]; widthPx: number }> {
    const probe = await this.runProbe(args.file);
    this.spawn();
    if (!this.remote?.extractFrameStrip) {
      this.terminateIfEphemeral();
      throw new Error("worker does not implement extractFrameStrip");
    }
    const extract = this.remote.extractFrameStrip as unknown as (a: {
      bytes: ArrayBuffer;
      fileExtension: string;
      durationSec: number;
      sourceWidth: number;
      sourceHeight: number;
      count: number;
      heightPx: number;
    }) => Promise<{ frames: Uint8Array[]; widthPx: number }>;
    const ext = (args.file.name.split(".").pop() ?? "").toLowerCase();
    try {
      const bytes = await args.file.arrayBuffer();
      const result = await extract({
        bytes,
        fileExtension: `.${ext}`,
        durationSec: probe.durationSec,
        sourceWidth: probe.width,
        sourceHeight: probe.height,
        count: args.count,
        heightPx: args.heightPx,
      });
      const urls = result.frames.map((frameBytes) => {
        // ArrayBuffer cast is safe — `frameBytes` came over Comlink as a
        // structured-cloned Uint8Array backed by an ArrayBuffer.
        const ab = frameBytes.buffer.slice(
          frameBytes.byteOffset,
          frameBytes.byteOffset + frameBytes.byteLength,
        ) as ArrayBuffer;
        return URL.createObjectURL(new Blob([ab], { type: "image/jpeg" }));
      });
      return { urls, widthPx: result.widthPx };
    } finally {
      this.terminateIfEphemeral();
    }
  }

  /** Force-terminate the persistent worker. No-op for ephemeral mode (the
   * worker is already gone) and a no-op when no worker has spawned yet.
   * Rejects any pending runSingle/runMulti calls before tearing down so
   * callers (e.g. a route page useEffect cleanup) don't hang on a worker
   * that has been terminated and will never reply. */
  dispose(): void {
    for (const reject of this.pendingRejecters) {
      reject(new DOMException("Disposed", "AbortError"));
    }
    this.pendingRejecters.clear();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.remote = null;
    }
  }

  private spawn(): void {
    if (this.worker) return;
    this.worker = this.factory();
    this.remote = Comlink.wrap<WorkerEntry<TOptions>>(this.worker);
  }

  private terminateIfEphemeral(): void {
    if (this.opts.persistent) return;
    this.worker?.terminate();
    this.worker = null;
    this.remote = null;
  }
}
