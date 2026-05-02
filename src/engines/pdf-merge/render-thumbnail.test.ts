import { beforeEach, describe, expect, it, vi } from "vitest";

describe("renderFirstPageThumbnail", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("rejects when pdfjs-dist's getDocument promise rejects", async () => {
    vi.doMock("pdfjs-dist", () => ({
      GlobalWorkerOptions: { workerSrc: "" },
      getDocument: () => ({ promise: Promise.reject(new Error("stub: invalid pdf")) }),
    }));
    const { renderFirstPageThumbnail } = await import("./render-thumbnail");
    await expect(renderFirstPageThumbnail(new ArrayBuffer(8), 32)).rejects.toThrow(
      /stub: invalid pdf/,
    );
    vi.doUnmock("pdfjs-dist");
  });

  it("returns a Blob when pdf.js resolves the render pipeline", async () => {
    const fakeBlob = new Blob(["png"], { type: "image/png" });
    const fakePage = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 200 * scale }),
      render: () => ({ promise: Promise.resolve() }),
    };
    const fakeDoc = {
      getPage: vi.fn(async () => fakePage),
      destroy: vi.fn(async () => undefined),
    };
    vi.doMock("pdfjs-dist", () => ({
      GlobalWorkerOptions: { workerSrc: "" },
      getDocument: () => ({ promise: Promise.resolve(fakeDoc) }),
    }));
    // OffscreenCanvas in jsdom doesn't have convertToBlob; stub it.
    type WithConvertToBlob = { convertToBlob?: unknown };
    const proto = (
      typeof OffscreenCanvas !== "undefined" ? OffscreenCanvas.prototype : undefined
    ) as WithConvertToBlob | undefined;
    const originalConvert = proto?.convertToBlob;
    if (proto) {
      proto.convertToBlob = async () => fakeBlob;
    }
    const { renderFirstPageThumbnail } = await import("./render-thumbnail");
    const result = await renderFirstPageThumbnail(new ArrayBuffer(8), 32);
    expect(result).toBeInstanceOf(Blob);
    expect(result.type).toBe("image/png");
    if (proto && originalConvert) {
      proto.convertToBlob = originalConvert;
    }
    vi.doUnmock("pdfjs-dist");
  });
});
