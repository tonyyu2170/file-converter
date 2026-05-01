import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { download } from "./download";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("download", () => {
  it("creates an anchor, clicks it, and revokes the URL after 1s", () => {
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
    expect(revokeSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(revokeSpy).toHaveBeenCalledOnce();
    expect(revokeSpy).toHaveBeenCalledWith("blob:mock");
  });
});
