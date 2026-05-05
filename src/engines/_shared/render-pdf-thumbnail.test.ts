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
    const { renderFirstPageThumbnail } = await import("./render-pdf-thumbnail");
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
    const { renderFirstPageThumbnail } = await import("./render-pdf-thumbnail");
    const result = await renderFirstPageThumbnail(new ArrayBuffer(8), 32);
    expect(result).toBeInstanceOf(Blob);
    expect(result.type).toBe("image/png");
    if (proto && originalConvert) {
      proto.convertToBlob = originalConvert;
    }
    vi.doUnmock("pdfjs-dist");
  });
});

describe("loadPdfDocument + renderPageThumbnail", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  // Shared fake page factory used across tests in this block.
  function makeFakePage() {
    return {
      getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 200 * scale }),
      render: () => ({ promise: Promise.resolve() }),
    };
  }

  // OffscreenCanvas.convertToBlob stub helpers.
  type WithConvertToBlob = { convertToBlob?: unknown };
  function stubConvertToBlob(fakeBlob: Blob): () => void {
    const proto = (
      typeof OffscreenCanvas !== "undefined" ? OffscreenCanvas.prototype : undefined
    ) as WithConvertToBlob | undefined;
    const original = proto?.convertToBlob;
    if (proto) {
      proto.convertToBlob = async () => fakeBlob;
    }
    return () => {
      if (proto) {
        if (original !== undefined) {
          proto.convertToBlob = original;
        } else {
          proto.convertToBlob = undefined;
        }
      }
    };
  }

  it("loadPdfDocument resolves with the PDFDocumentProxy returned by pdf.js", async () => {
    const fakePage = makeFakePage();
    const fakeDoc = {
      numPages: 5,
      getPage: vi.fn(async (_n: number) => fakePage),
      destroy: vi.fn(async () => undefined),
    };
    vi.doMock("pdfjs-dist", () => ({
      GlobalWorkerOptions: { workerSrc: "" },
      getDocument: () => ({ promise: Promise.resolve(fakeDoc) }),
    }));
    const { loadPdfDocument } = await import("./render-pdf-thumbnail");
    const doc = await loadPdfDocument(new ArrayBuffer(8));
    expect(doc.numPages).toBe(5);
    vi.doUnmock("pdfjs-dist");
  });

  it("renderPageThumbnail calls getPage with pageIndex+1 and returns a PNG Blob", async () => {
    const fakeBlob = new Blob(["png"], { type: "image/png" });
    const restore = stubConvertToBlob(fakeBlob);
    const fakePage = makeFakePage();
    const fakeDoc = {
      numPages: 3,
      getPage: vi.fn(async (_n: number) => fakePage),
      destroy: vi.fn(async () => undefined),
    };
    vi.doMock("pdfjs-dist", () => ({
      GlobalWorkerOptions: { workerSrc: "" },
      getDocument: () => ({ promise: Promise.resolve(fakeDoc) }),
    }));
    const { renderPageThumbnail } = await import("./render-pdf-thumbnail");
    const result = await renderPageThumbnail(fakeDoc as never, 2, 64);
    // 0-based index 2 → pdf.js 1-based page 3.
    expect(fakeDoc.getPage).toHaveBeenCalledWith(3);
    expect(result).toBeInstanceOf(Blob);
    expect(result.type).toBe("image/png");
    restore();
    vi.doUnmock("pdfjs-dist");
  });

  it("renderPageThumbnail rejects when getPage rejects (out-of-range page)", async () => {
    const fakePage = makeFakePage();
    const fakeDoc = {
      numPages: 3,
      getPage: vi.fn(async (n: number) => {
        if (n === 1000) throw new Error("page out of range");
        return fakePage;
      }),
      destroy: vi.fn(async () => undefined),
    };
    vi.doMock("pdfjs-dist", () => ({
      GlobalWorkerOptions: { workerSrc: "" },
      getDocument: () => ({ promise: Promise.resolve(fakeDoc) }),
    }));
    const { renderPageThumbnail } = await import("./render-pdf-thumbnail");
    // pageIndex 999 → getPage(1000) → throws
    await expect(renderPageThumbnail(fakeDoc as never, 999, 64)).rejects.toThrow(
      /page out of range/,
    );
    vi.doUnmock("pdfjs-dist");
  });
});
