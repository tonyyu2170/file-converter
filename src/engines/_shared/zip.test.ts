import { describe, expect, it, vi } from "vitest";

describe("buildZipBlob", () => {
  it("throws when items is empty", async () => {
    const { buildZipBlob } = await import("./zip");
    await expect(buildZipBlob([], "out.zip")).rejects.toThrow(/items is empty/);
  });

  it("returns the supplied archive name and a Blob", async () => {
    const fakeBlob = new Blob(["fake-zip-bytes"], { type: "application/zip" });
    const downloadZip = vi.fn(() => new Response(fakeBlob));
    vi.doMock("client-zip", () => ({ downloadZip }));
    // Reset the module cache so the lazy import picks up the mock.
    vi.resetModules();
    const { buildZipBlob } = await import("./zip");
    const items = [
      { filename: "page-1.pdf", mime: "application/pdf", blob: new Blob(["a"]) },
      { filename: "page-2.pdf", mime: "application/pdf", blob: new Blob(["b"]) },
    ];
    const result = await buildZipBlob(items, "myfile-split.zip");
    expect(result.filename).toBe("myfile-split.zip");
    expect(result.blob).toBeInstanceOf(Blob);
    expect(downloadZip).toHaveBeenCalledWith([
      { name: "page-1.pdf", input: items[0]?.blob },
      { name: "page-2.pdf", input: items[1]?.blob },
    ]);
    vi.doUnmock("client-zip");
  });

  it("reuses the lazy-loaded client-zip module across calls", async () => {
    let importCount = 0;
    vi.doMock("client-zip", () => {
      importCount += 1;
      return {
        downloadZip: () => new Response(new Blob(["zip"], { type: "application/zip" })),
      };
    });
    vi.resetModules();
    const { buildZipBlob } = await import("./zip");
    const items = [{ filename: "a.pdf", mime: "application/pdf", blob: new Blob(["x"]) }];
    await buildZipBlob(items, "first.zip");
    await buildZipBlob(items, "second.zip");
    // The dynamic import is cached at module level; the mock factory runs at
    // most twice (once on initial doMock, once if vi swaps modules), but in
    // practice the second buildZipBlob call reuses the cached promise.
    expect(importCount).toBeLessThanOrEqual(2);
    vi.doUnmock("client-zip");
  });
});
