import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@huggingface/transformers", () => {
  const env = {
    allowRemoteModels: true,
    allowLocalModels: false,
    localModelPath: "",
    backends: { onnx: { wasm: { wasmPaths: "" } } },
  };
  const pipeline = vi.fn();
  return { env, pipeline };
});

import { env, pipeline } from "@huggingface/transformers";
import { __resetForTests, getBgRemovalPipeline } from "./model-loader";

afterEach(() => {
  __resetForTests();
  vi.clearAllMocks();
});

describe("model-loader env", () => {
  it("disables remote models and points local path at /models/", async () => {
    expect(env.allowRemoteModels).toBe(false);
    expect(env.allowLocalModels).toBe(true);
    expect(env.localModelPath).toBe("/models/");
    expect(env.backends.onnx.wasm?.wasmPaths).toBe("/onnx-wasm/");
  });
});

describe("getBgRemovalPipeline", () => {
  it("memoizes the pipeline across calls", async () => {
    (pipeline as ReturnType<typeof vi.fn>).mockResolvedValue("PIPE");
    const a = await getBgRemovalPipeline(() => {});
    const b = await getBgRemovalPipeline(() => {});
    expect(a).toBe(b);
    expect(pipeline).toHaveBeenCalledTimes(1);
  });

  it("resets the cached promise after a failure so the next call retries", async () => {
    (pipeline as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("net"))
      .mockResolvedValueOnce("PIPE");
    await expect(getBgRemovalPipeline(() => {})).rejects.toThrow("net");
    const second = await getBgRemovalPipeline(() => {});
    expect(second).toBe("PIPE");
    expect(pipeline).toHaveBeenCalledTimes(2);
  });

  it("translates transformers.js progress events to LoaderProgress", async () => {
    (pipeline as ReturnType<typeof vi.fn>).mockImplementation(async (_task, _model, opts) => {
      opts.progress_callback({ status: "progress", loaded: 25, total: 100 });
      opts.progress_callback({ status: "ready" });
      return "PIPE";
    });
    const events: unknown[] = [];
    await getBgRemovalPipeline((p) => events.push(p));
    expect(events).toEqual([{ kind: "model-loading", loaded: 25, total: 100 }, { kind: "ready" }]);
  });

  it("passes dtype: fp16 to the pipeline call", async () => {
    (pipeline as ReturnType<typeof vi.fn>).mockResolvedValue("PIPE");
    await getBgRemovalPipeline(() => {});
    expect(pipeline).toHaveBeenCalledWith(
      "image-segmentation",
      "bg-remove",
      expect.objectContaining({ dtype: "fp16" }),
    );
  });
});
