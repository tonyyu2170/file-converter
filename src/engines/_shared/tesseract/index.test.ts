import { afterEach, describe, expect, it, vi } from "vitest";

// Capture the logger callback that createWorker receives so logger-delegation
// tests can fire progress events directly without a real browser worker.
let capturedLogger: ((m: Record<string, unknown>) => void) | null = null;

vi.mock("tesseract.js", () => ({
  createWorker: vi.fn(async (_langs: string, _oem: number, opts: Record<string, unknown>) => {
    capturedLogger = opts.logger as (m: Record<string, unknown>) => void;
    return { terminate: vi.fn().mockResolvedValue(undefined) };
  }),
  // Provide the OEM constant so callers that import it still resolve.
  OEM: { TESSERACT_ONLY: 0, LSTM_ONLY: 1, TESSERACT_LSTM_COMBINED: 2, DEFAULT: 3 },
}));

import { createWorker } from "tesseract.js";
import { __resetForTests, disposeTesseract, loadTesseract, setProgressLogger } from "./index";

afterEach(async () => {
  // disposeTesseract terminates the worker and clears the singleton.
  // __resetForTests skips termination (for error-path tests that never got a worker).
  await disposeTesseract();
  __resetForTests();
  capturedLogger = null;
  vi.clearAllMocks();
});

describe("loadTesseract singleton", () => {
  it("returns the same promise on repeated calls (singleton identity)", async () => {
    const p1 = loadTesseract();
    const p2 = loadTesseract();
    expect(p1).toBe(p2);
    await p1;
    expect(createWorker).toHaveBeenCalledTimes(1);
  });

  it("after disposeTesseract(), next loadTesseract() returns a fresh promise", async () => {
    const p1 = loadTesseract();
    await p1;
    await disposeTesseract();
    const p2 = loadTesseract();
    expect(p1).not.toBe(p2);
    await p2;
    expect(createWorker).toHaveBeenCalledTimes(2);
  });

  it("after __resetForTests(), next loadTesseract() returns a fresh promise", async () => {
    const p1 = loadTesseract();
    await p1;
    __resetForTests();
    const p2 = loadTesseract();
    expect(p1).not.toBe(p2);
  });
});

describe("loadTesseract createWorker call shape", () => {
  it("passes lang='eng', OEM=1 (LSTM_ONLY), and same-origin absolute paths", async () => {
    await loadTesseract();
    expect(createWorker).toHaveBeenCalledTimes(1);
    // Paths must be absolute URLs (origin-prefixed) so that importScripts()
    // resolves correctly when Tesseract's blob-worker calls importScripts
    // (blob: URLs have no base origin to resolve root-relative paths against).
    // corePath explicitly names the simd-lstm variant to bypass getCore.js's
    // WASM-feature-detect heuristic (which selects relaxedsimd-lstm but that
    // binary contains x86 SSE code that crashes on ARM).
    expect(createWorker).toHaveBeenCalledWith(
      "eng",
      1, // OEM.LSTM_ONLY
      expect.objectContaining({
        langPath: expect.stringContaining("/tesseract/"),
        corePath: expect.stringContaining("/tesseract/tesseract-core-simd-lstm.wasm.js"),
        workerPath: expect.stringContaining("/tesseract/worker.min.js"),
      }),
    );
  });
});

describe("loadTesseract error handling", () => {
  it("clears instancePromise on createWorker rejection so next call retries", async () => {
    const createWorkerMock = createWorker as unknown as ReturnType<typeof vi.fn>;
    createWorkerMock.mockRejectedValueOnce(new Error("worker spawn failed"));

    await expect(loadTesseract()).rejects.toThrow("worker spawn failed");

    // Next call must NOT return the failed promise — it retries.
    const p2 = loadTesseract();
    await expect(p2).resolves.toBeDefined();
    expect(createWorkerMock).toHaveBeenCalledTimes(2);
  });
});

describe("setProgressLogger delegation", () => {
  it("installed callback receives progress events from the worker", async () => {
    await loadTesseract();

    const cb = vi.fn();
    setProgressLogger(cb);

    // Simulate a progress event from the tesseract worker's onMessage handler.
    capturedLogger?.({
      status: "recognizing text",
      progress: 0.5,
      jobId: "j1",
      userJobId: "u1",
      workerId: "w1",
    });

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ status: "recognizing text", progress: 0.5 });
  });

  it("setProgressLogger(null) silences events without throwing", async () => {
    await loadTesseract();

    setProgressLogger(vi.fn());
    setProgressLogger(null);

    // Must not throw even when a progress event arrives with no active logger.
    expect(() => {
      capturedLogger?.({
        status: "recognizing text",
        progress: 0.3,
        jobId: "j1",
        userJobId: "u1",
        workerId: "w1",
      });
    }).not.toThrow();
  });

  it("swapping from cb1 to cb2 routes events to cb2 only", async () => {
    await loadTesseract();

    const cb1 = vi.fn();
    const cb2 = vi.fn();

    setProgressLogger(cb1);
    capturedLogger?.({
      status: "recognizing text",
      progress: 0.2,
      jobId: "j1",
      userJobId: "u1",
      workerId: "w1",
    });
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(0);

    setProgressLogger(cb2);
    capturedLogger?.({
      status: "recognizing text",
      progress: 0.8,
      jobId: "j2",
      userJobId: "u2",
      workerId: "w1",
    });
    expect(cb1).toHaveBeenCalledTimes(1); // no new calls
    expect(cb2).toHaveBeenCalledTimes(1);
  });
});
