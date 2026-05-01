import * as Comlink from "comlink";
import type { OutputItem } from "./types";

export type WorkerEntry<TOptions> = {
  convertSingle?: (
    fileBytes: ArrayBuffer,
    fileName: string,
    fileType: string,
    opts: TOptions,
  ) => Promise<OutputItem | OutputItem[]>;
  convertMulti?: (
    files: Array<{ bytes: ArrayBuffer; name: string; type: string }>,
    opts: TOptions,
  ) => Promise<OutputItem | OutputItem[]>;
};

export type WorkerFactory = () => Worker;

// Comlink's Remote<T> rewrites function-argument types via the internal
// UnproxyOrClone<T> mapper, which a generic TOptions cannot satisfy
// without a cast. SingleFn / MultiFn are concrete callable shapes used
// at the call sites after a runtime truthiness guard.
type SingleFn<TOptions> = (
  fileBytes: ArrayBuffer,
  fileName: string,
  fileType: string,
  opts: TOptions,
) => Promise<OutputItem | OutputItem[]>;

type MultiFn<TOptions> = (
  files: Array<{ bytes: ArrayBuffer; name: string; type: string }>,
  opts: TOptions,
) => Promise<OutputItem | OutputItem[]>;

export class WorkerHarness<TOptions> {
  private worker: Worker | null = null;
  private remote: Comlink.Remote<WorkerEntry<TOptions>> | null = null;

  constructor(private readonly factory: WorkerFactory) {}

  async runSingle(
    file: File,
    opts: TOptions,
    signal: AbortSignal,
  ): Promise<OutputItem | OutputItem[]> {
    this.spawn();
    if (!this.remote?.convertSingle) {
      this.terminate();
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
      this.terminate();
      throw new DOMException("Aborted", "AbortError");
    }
    const abortPromise = new Promise<never>((_, reject) => {
      const onAbort = () => {
        this.terminate();
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      const result = await Promise.race([
        convertSingle(buf, file.name, file.type, opts),
        abortPromise,
      ]);
      return result;
    } finally {
      this.terminate();
    }
  }

  async runMulti(
    files: File[],
    opts: TOptions,
    signal: AbortSignal,
  ): Promise<OutputItem | OutputItem[]> {
    this.spawn();
    if (!this.remote?.convertMulti) {
      this.terminate();
      throw new Error("worker does not implement convertMulti");
    }
    // Cast to the concrete callable type — same reason as in runSingle.
    const convertMulti = this.remote.convertMulti as unknown as MultiFn<TOptions>;
    const payload = await Promise.all(
      files.map(async (f) => ({ bytes: await f.arrayBuffer(), name: f.name, type: f.type })),
    );
    // Early exit if signal was already aborted before reaching this point.
    if (signal.aborted) {
      this.terminate();
      throw new DOMException("Aborted", "AbortError");
    }
    const abortPromise = new Promise<never>((_, reject) => {
      const onAbort = () => {
        this.terminate();
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      const result = await Promise.race([convertMulti(payload, opts), abortPromise]);
      return result;
    } finally {
      this.terminate();
    }
  }

  private spawn(): void {
    if (this.worker) return;
    this.worker = this.factory();
    this.remote = Comlink.wrap<WorkerEntry<TOptions>>(this.worker);
  }

  private terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.remote = null;
  }
}
