import * as Comlink from "comlink";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkerHarness } from "./harness";
import type { OutputItem } from "./types";

// vi.spyOn cannot redefine ESM live bindings; hoist a module mock instead.
vi.mock("comlink", () => ({ wrap: vi.fn() }));

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
});
