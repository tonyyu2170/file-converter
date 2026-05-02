import { afterEach, describe, expect, it } from "vitest";
import { stageFiles, takeStagedFiles } from "./handoff";

afterEach(() => {
  takeStagedFiles();
});

describe("file handoff", () => {
  it("returns an empty array when no files have been staged", () => {
    expect(takeStagedFiles()).toEqual([]);
  });

  it("returns the staged files once, then empty on subsequent calls", () => {
    const a = new File(["a"], "a.png", { type: "image/png" });
    const b = new File(["b"], "b.jpg", { type: "image/jpeg" });
    stageFiles([a, b]);
    expect(takeStagedFiles()).toEqual([a, b]);
    expect(takeStagedFiles()).toEqual([]);
  });

  it("most recent stage replaces a prior staged set", () => {
    const a = new File(["a"], "a.png", { type: "image/png" });
    const b = new File(["b"], "b.jpg", { type: "image/jpeg" });
    const c = new File(["c"], "c.webp", { type: "image/webp" });
    stageFiles([a]);
    stageFiles([b, c]);
    expect(takeStagedFiles()).toEqual([b, c]);
    expect(takeStagedFiles()).toEqual([]);
  });

  it("stages a single-file array correctly (single-input pattern)", () => {
    const f = new File(["f"], "single.heic", { type: "image/heic" });
    stageFiles([f]);
    expect(takeStagedFiles()).toEqual([f]);
  });

  it("does not leak external mutations into the staged slot", () => {
    const arr = [new File(["a"], "a.png", { type: "image/png" })];
    stageFiles(arr);
    arr.push(new File(["b"], "b.png", { type: "image/png" }));
    expect(takeStagedFiles()).toHaveLength(1);
  });
});
