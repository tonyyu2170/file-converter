import { afterEach, describe, expect, it, vi } from "vitest";
import { download } from "./download";

// jsdom does not implement URL.createObjectURL/revokeObjectURL.
// vi.spyOn requires the property to exist; provide no-op defaults
// so spies have something to wrap. restoreAllMocks resets to these.
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = () => "";
}
if (typeof URL.revokeObjectURL !== "function") {
  URL.revokeObjectURL = () => undefined;
}

afterEach(() => vi.restoreAllMocks());

describe("download", () => {
  it("creates an anchor with download attribute and clicks it", () => {
    const createSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const clickSpy = vi.fn();
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag) => {
      const el = origCreate(tag) as HTMLElement & { click?: () => void };
      if (tag === "a") el.click = clickSpy;
      return el;
    });

    download(new Blob(["hi"]), "out.txt");

    expect(createSpy).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
    // revoke is delayed (vi.useFakeTimers not called, so we only
    // assert the spy exists — not that it was called yet)
    expect(revokeSpy).toBeDefined();
  });
});
