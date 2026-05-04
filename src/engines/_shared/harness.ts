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
    const buf = await file.arrayBuffer();
    // Early exit if signal was already aborted before reaching this point.
    if (signal.aborted) {
      this.terminateIfEphemeral();
      throw new DOMException("Aborted", "AbortError");
    }
    const abortPromise = new Promise<never>((_, reject) => {
      const onAbort = () => {
        this.terminateIfEphemeral();
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
    const proxiedOnProgress = runOpts.onProgress ? Comlink.proxy(runOpts.onProgress) : undefined;
    try {
      const result = await Promise.race([
        convertSingle(buf, file.name, file.type, opts, proxiedOnProgress),
        abortPromise,
      ]);
      return result;
    } finally {
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
    const payload = await Promise.all(
      files.map(async (f) => ({ bytes: await f.arrayBuffer(), name: f.name, type: f.type })),
    );
    // Early exit if signal was already aborted before reaching this point.
    if (signal.aborted) {
      this.terminateIfEphemeral();
      throw new DOMException("Aborted", "AbortError");
    }
    const abortPromise = new Promise<never>((_, reject) => {
      const onAbort = () => {
        this.terminateIfEphemeral();
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
    const proxiedOnProgress = runOpts.onProgress ? Comlink.proxy(runOpts.onProgress) : undefined;
    try {
      const result = await Promise.race([
        convertMulti(payload, opts, proxiedOnProgress),
        abortPromise,
      ]);
      return result;
    } finally {
      this.terminateIfEphemeral();
    }
  }

  /** Force-terminate the persistent worker. No-op for ephemeral mode (the
   * worker is already gone) and a no-op when no worker has spawned yet. */
  dispose(): void {
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
