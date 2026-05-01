import { afterEach, describe, expect, it } from "vitest";
import { stageFile, takeStagedFile } from "./handoff";

afterEach(() => {
  takeStagedFile();
});

describe("file handoff", () => {
  it("returns null when no file has been staged", () => {
    expect(takeStagedFile()).toBeNull();
  });

  it("returns the staged file once, then null on subsequent calls", () => {
    const file = new File(["x"], "test.heic", { type: "image/heic" });
    stageFile(file);
    expect(takeStagedFile()).toBe(file);
    expect(takeStagedFile()).toBeNull();
  });

  it("most recent stage replaces a prior staged file", () => {
    const a = new File(["a"], "a.heic", { type: "image/heic" });
    const b = new File(["b"], "b.heic", { type: "image/heic" });
    stageFile(a);
    stageFile(b);
    expect(takeStagedFile()).toBe(b);
    expect(takeStagedFile()).toBeNull();
  });
});
