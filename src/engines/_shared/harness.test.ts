import * as Comlink from "comlink";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkerHarness } from "./harness";
import type { OutputItem } from "./types";

// vi.spyOn cannot redefine ESM live bindings; hoist a module mock instead.
// `proxy` is mocked as identity so test-stubbed convertSingle implementations
// can invoke the host onProgress callback synchronously without crossing a
// real Comlink boundary.
vi.mock("comlink", () => ({
  wrap: vi.fn(),
  proxy: vi.fn((fn) => fn),
}));

afterEach(() => vi.restoreAllMocks());

function fakeWorker() {
  const w = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as Worker;
  return w;
}

function makeOutput(name: string): OutputItem {
  return {
    filename: name,
    mime: "application/octet-stream",
    blob: new Blob([new Uint8Array([0])]),
  };
}

describe("WorkerHarness.runSingle", () => {
  it("forwards file bytes and resolves with the worker result", async () => {
    vi.mocked(Comlink.wrap).mockReturnValue({
      convertSingle: async (
        bytes: ArrayBuffer,
        name: string,
        _type: string,
        _opts: unknown,
      ): Promise<OutputItem> => ({
        filename: name.replace(/\.heic$/, ".png"),
        mime: "image/png",
        blob: new Blob([new Uint8Array(bytes).slice(0, 1)], { type: "image/png" }),
      }),
    } as never);

    const h = new WorkerHarness<{ q: number }>(fakeWorker);
    const file = new File([new Uint8Array([1, 2, 3])], "vacation.heic", { type: "image/heic" });
    const out = (await h.runSingle(file, { q: 90 }, new AbortController().signal)) as OutputItem;
    expect(out.filename).toBe("vacation.png");
    expect(out.mime).toBe("image/png");
    expect(Comlink.wrap).toHaveBeenCalledOnce();
  });

  it("rejects with AbortError when the signal is already aborted", async () => {
    vi.mocked(Comlink.wrap).mockReturnValue({
      convertSingle: () => new Promise(() => undefined),
    } as never);
    const ctrl = new AbortController();
    ctrl.abort();
    const h = new WorkerHarness<{ q: number }>(fakeWorker);
    const f = new File([new Uint8Array([1])], "x.heic", { type: "image/heic" });
    await expect(h.runSingle(f, { q: 90 }, ctrl.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("terminates worker and rejects when aborted mid-conversion", async () => {
    vi.mocked(Comlink.wrap).mockReturnValue({
      convertSingle: () =>
        new Promise<OutputItem>((_resolve) => {
          // Promise intentionally never resolves — keeps the worker busy.
        }),
    } as never);
    const fw = fakeWorker();
    const h = new WorkerHarness<{ q: number }>(() => fw);
    const ctrl = new AbortController();
    const f = new File([new Uint8Array([1])], "x.heic", { type: "image/heic" });
    const p = h.runSingle(f, { q: 90 }, ctrl.signal);
    // Yield the microtask queue so file.arrayBuffer() resolves and the race begins.
    await Promise.resolve();
    await Promise.resolve();
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(fw.terminate).toHaveBeenCalled();
  });
});

describe("WorkerHarness (existing behavior)", () => {
  it("terminates the worker after each runSingle call by default", async () => {
    vi.mocked(Comlink.wrap).mockReturnValue({
      convertSingle: async (_b: ArrayBuffer, name: string): Promise<OutputItem> => makeOutput(name),
    } as never);

    let factoryCalls = 0;
    const workers: Worker[] = [];
    const factory = () => {
      factoryCalls += 1;
      const fw = fakeWorker();
      workers.push(fw);
      return fw;
    };
    const h = new WorkerHarness<Record<string, never>>(factory);
    const f1 = new File([new Uint8Array([1])], "a.bin");
    const f2 = new File([new Uint8Array([2])], "b.bin");
    await h.runSingle(f1, {}, new AbortController().signal);
    await h.runSingle(f2, {}, new AbortController().signal);
    expect(factoryCalls).toBe(2);
    expect(workers[0]?.terminate).toHaveBeenCalledOnce();
    expect(workers[1]?.terminate).toHaveBeenCalledOnce();
  });

  it("terminates the worker after each runMulti call by default", async () => {
    vi.mocked(Comlink.wrap).mockReturnValue({
      convertMulti: async (
        files: Array<{ bytes: ArrayBuffer; name: string; type: string }>,
      ): Promise<OutputItem> => makeOutput(files[0]?.name ?? "out.bin"),
    } as never);

    let factoryCalls = 0;
    const workers: Worker[] = [];
    const factory = () => {
      factoryCalls += 1;
      const fw = fakeWorker();
      workers.push(fw);
      return fw;
    };
    const h = new WorkerHarness<Record<string, never>>(factory);
    const f1 = [new File([new Uint8Array([1])], "a.bin")];
    const f2 = [new File([new Uint8Array([2])], "b.bin")];
    await h.runMulti(f1, {}, new AbortController().signal);
    await h.runMulti(f2, {}, new AbortController().signal);
    expect(factoryCalls).toBe(2);
    expect(workers[0]?.terminate).toHaveBeenCalledOnce();
    expect(workers[1]?.terminate).toHaveBeenCalledOnce();
  });
});

describe("WorkerHarness persistent mode", () => {
  it("reuses one worker across multiple runSingle calls when persistent: true", async () => {
    vi.mocked(Comlink.wrap).mockReturnValue({
      convertSingle: async (_b: ArrayBuffer, name: string): Promise<OutputItem> => makeOutput(name),
    } as never);

    let factoryCalls = 0;
    const factory = () => {
      factoryCalls += 1;
      return fakeWorker();
    };
    const h = new WorkerHarness<Record<string, never>>(factory, { persistent: true });
    const f1 = new File([new Uint8Array([1])], "a.bin");
    const f2 = new File([new Uint8Array([2])], "b.bin");
    await h.runSingle(f1, {}, new AbortController().signal);
    await h.runSingle(f2, {}, new AbortController().signal);
    expect(factoryCalls).toBe(1);
  });

  it("dispose() terminates the persistent worker", async () => {
    vi.mocked(Comlink.wrap).mockReturnValue({
      convertSingle: async (_b: ArrayBuffer, name: string): Promise<OutputItem> => makeOutput(name),
    } as never);

    const fw = fakeWorker();
    const h = new WorkerHarness<Record<string, never>>(() => fw, { persistent: true });
    const f = new File([new Uint8Array([1])], "a.bin");
    await h.runSingle(f, {}, new AbortController().signal);
    // Should not have been terminated yet — persistent mode keeps it alive.
    expect(fw.terminate).not.toHaveBeenCalled();
    h.dispose();
    expect(fw.terminate).toHaveBeenCalledOnce();
  });

  it("dispose() rejects pending runSingle calls so they don't hang", async () => {
    // convertSingle returns a Promise that never resolves — simulates a slow
    // model load or in-flight inference. Without dispose() rejecting the
    // pending call, terminating the worker would leave the runSingle Promise
    // dangling forever (the worker can never reply).
    vi.mocked(Comlink.wrap).mockReturnValue({
      convertSingle: () => new Promise<OutputItem>(() => undefined),
    } as never);

    const fw = fakeWorker();
    const h = new WorkerHarness<Record<string, never>>(() => fw, { persistent: true });
    const ctrl = new AbortController();
    const f = new File([new Uint8Array(1)], "a.bin");
    const pending = h.runSingle(f, {}, ctrl.signal);
    // Attach a catch handler immediately so the rejection isn't flagged as
    // unhandled while we wait for the abortPromise to be registered.
    const settled = pending.catch((e) => e);
    // Yield the macrotask queue so file.arrayBuffer() resolves and the race
    // begins — i.e. the abortPromise is constructed and rejecter registered.
    // setTimeout(0) flushes the microtask queue more reliably than chained
    // Promise.resolve() awaits when File.arrayBuffer() involves a Blob-read
    // task (which lands on the macrotask queue in jsdom).
    await new Promise((r) => setTimeout(r, 0));
    h.dispose();
    const err = await settled;
    expect(err).toMatchObject({ name: "AbortError" });
    expect(fw.terminate).toHaveBeenCalledOnce();
  });

  it("dispose() rejects pending runMulti calls so they don't hang", async () => {
    vi.mocked(Comlink.wrap).mockReturnValue({
      convertMulti: () => new Promise<OutputItem>(() => undefined),
    } as never);

    const fw = fakeWorker();
    const h = new WorkerHarness<Record<string, never>>(() => fw, { persistent: true });
    const ctrl = new AbortController();
    const files = [new File([new Uint8Array(1)], "a.bin")];
    const pending = h.runMulti(files, {}, ctrl.signal);
    const settled = pending.catch((e) => e);
    await new Promise((r) => setTimeout(r, 0));
    h.dispose();
    const err = await settled;
    expect(err).toMatchObject({ name: "AbortError" });
    expect(fw.terminate).toHaveBeenCalledOnce();
  });

  it("dispose() is a no-op for ephemeral mode", async () => {
    vi.mocked(Comlink.wrap).mockReturnValue({
      convertSingle: async (_b: ArrayBuffer, name: string): Promise<OutputItem> => makeOutput(name),
    } as never);

    const h = new WorkerHarness<Record<string, never>>(fakeWorker);
    // dispose() before any spawn — must not throw.
    expect(() => h.dispose()).not.toThrow();
    // dispose() after a runSingle (which already terminated the ephemeral
    // worker) — must also be a no-op.
    const f = new File([new Uint8Array([1])], "a.bin");
    await h.runSingle(f, {}, new AbortController().signal);
    expect(() => h.dispose()).not.toThrow();
  });
});

describe("WorkerHarness onProgress callback", () => {
  it("forwards worker-emitted progress events to onProgress", async () => {
    const convertSingle = vi.fn(
      async (
        _b: ArrayBuffer,
        name: string,
        _t: string,
        _o: unknown,
        onProgress?: (p: unknown) => void,
      ): Promise<OutputItem> => {
        onProgress?.({ kind: "model-loading", loaded: 10, total: 100 });
        onProgress?.({ kind: "inference", pct: 0 });
        return makeOutput(name);
      },
    );
    vi.mocked(Comlink.wrap).mockReturnValue({ convertSingle } as never);

    const onProgress = vi.fn();
    const h = new WorkerHarness<Record<string, never>>(fakeWorker);
    const f = new File([new Uint8Array([1])], "a.bin");
    await h.runSingle(f, {}, new AbortController().signal, { onProgress });
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, {
      kind: "model-loading",
      loaded: 10,
      total: 100,
    });
    expect(onProgress).toHaveBeenNthCalledWith(2, { kind: "inference", pct: 0 });
    // Comlink.proxy must have been called to wrap the host callback before
    // it crosses the worker boundary.
    expect(Comlink.proxy).toHaveBeenCalledWith(onProgress);
  });

  it("passes undefined to worker when onProgress is omitted", async () => {
    // Typed with all 5 params so `mock.calls[0][4]` is in-bounds at the
    // type level — the harness must invoke convertSingle with positional
    // undefined when the host omits onProgress.
    const convertSingle = vi.fn(
      async (
        _b: ArrayBuffer,
        name: string,
        _t: string,
        _o: unknown,
        _onProgress?: (p: unknown) => void,
      ): Promise<OutputItem> => makeOutput(name),
    );
    vi.mocked(Comlink.wrap).mockReturnValue({ convertSingle } as never);

    const h = new WorkerHarness<Record<string, never>>(fakeWorker);
    const f = new File([new Uint8Array([1])], "a.bin");
    await h.runSingle(f, {}, new AbortController().signal);
    expect(convertSingle).toHaveBeenCalledTimes(1);
    // 5th positional arg (onProgress) must be undefined.
    expect(convertSingle.mock.calls[0]?.[4]).toBeUndefined();
    expect(Comlink.proxy).not.toHaveBeenCalled();
  });
});
