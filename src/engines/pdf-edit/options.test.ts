import { describe, expect, it } from "vitest";
import {
  type PdfEditOptions,
  applyRotateAll,
  defaultPdfEditOptions,
  deletePage,
  movePage,
  rotatePage,
  seedFromPageCount,
} from "./options";

describe("pdf-edit options", () => {
  it("default options are empty", () => {
    expect(defaultPdfEditOptions).toEqual({ pages: [], totalSourcePages: 0 });
  });

  it("seedFromPageCount creates one entry per page with rotation 0", () => {
    const opts = seedFromPageCount(3);
    expect(opts.totalSourcePages).toBe(3);
    expect(opts.pages.map((p) => p.sourceIndex)).toEqual([0, 1, 2]);
    expect(opts.pages.map((p) => p.rotation)).toEqual([0, 0, 0]);
    // ids must be unique strings
    const ids = new Set(opts.pages.map((p) => p.id));
    expect(ids.size).toBe(3);
  });

  it("rotatePage cycles rotation 0->90->180->270->0", () => {
    let o = seedFromPageCount(2);
    o = rotatePage(o, o.pages[0]!.id);
    expect(o.pages[0]!.rotation).toBe(90);
    o = rotatePage(o, o.pages[0]!.id);
    expect(o.pages[0]!.rotation).toBe(180);
    o = rotatePage(o, o.pages[0]!.id);
    expect(o.pages[0]!.rotation).toBe(270);
    o = rotatePage(o, o.pages[0]!.id);
    expect(o.pages[0]!.rotation).toBe(0);
    // Other pages untouched
    expect(o.pages[1]!.rotation).toBe(0);
  });

  it("rotatePage on unknown id is a no-op", () => {
    const o = seedFromPageCount(2);
    expect(rotatePage(o, "nonexistent")).toEqual(o);
  });

  it("applyRotateAll adds 90 to every page modulo 360", () => {
    let o = seedFromPageCount(3);
    o = rotatePage(o, o.pages[0]!.id); // page 0 -> 90
    o = rotatePage(o, o.pages[2]!.id); // page 2 -> 90
    o = applyRotateAll(o);
    // page 0: 90 + 90 = 180
    // page 1: 0 + 90 = 90
    // page 2: 90 + 90 = 180
    expect(o.pages.map((p) => p.rotation)).toEqual([180, 90, 180]);
  });

  it("deletePage removes the entry", () => {
    let o = seedFromPageCount(3);
    const middleId = o.pages[1]!.id;
    o = deletePage(o, middleId);
    expect(o.pages.length).toBe(2);
    expect(o.pages.map((p) => p.sourceIndex)).toEqual([0, 2]);
    expect(o.totalSourcePages).toBe(3); // unchanged
  });

  it("deletePage on unknown id is a no-op", () => {
    const o = seedFromPageCount(2);
    expect(deletePage(o, "nonexistent")).toEqual(o);
  });

  it("movePage reorders correctly", () => {
    let o = seedFromPageCount(4);
    // Move page index 0 to position 2
    o = movePage(o, 0, 2);
    expect(o.pages.map((p) => p.sourceIndex)).toEqual([1, 2, 0, 3]);
  });

  it("movePage with out-of-range indices is a no-op", () => {
    const o = seedFromPageCount(3);
    expect(movePage(o, -1, 0)).toEqual(o);
    expect(movePage(o, 0, 99)).toEqual(o);
    expect(movePage(o, 99, 0)).toEqual(o);
  });
});
