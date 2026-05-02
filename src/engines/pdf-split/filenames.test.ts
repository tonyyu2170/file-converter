import { describe, expect, it } from "vitest";
import { planSplitFilenames } from "./filenames";

describe("planSplitFilenames", () => {
  it("returns empty array for empty tokens", () => {
    expect(planSplitFilenames([])).toEqual([]);
  });

  it("formats single-page token as 'page-N.pdf'", () => {
    expect(planSplitFilenames([{ original: "5", indices: [4] }])).toEqual(["page-5.pdf"]);
  });

  it("formats single-page token from N-N closed range as 'page-N.pdf'", () => {
    expect(planSplitFilenames([{ original: "3-3", indices: [2] }])).toEqual(["page-3.pdf"]);
  });

  it("formats closed-range token as 'pages-N-M.pdf'", () => {
    expect(planSplitFilenames([{ original: "1-3", indices: [0, 1, 2] }])).toEqual([
      "pages-1-3.pdf",
    ]);
  });

  it("formats open-end token using resolved final index", () => {
    expect(planSplitFilenames([{ original: "7-", indices: [6, 7, 8, 9] }])).toEqual([
      "pages-7-10.pdf",
    ]);
  });

  it("formats open-start token using resolved indices", () => {
    expect(planSplitFilenames([{ original: "-3", indices: [0, 1, 2] }])).toEqual(["pages-1-3.pdf"]);
  });

  it("returns multiple filenames for multi-token list", () => {
    const result = planSplitFilenames([
      { original: "1-3", indices: [0, 1, 2] },
      { original: "5", indices: [4] },
      { original: "7-", indices: [6, 7, 8, 9] },
    ]);
    expect(result).toEqual(["pages-1-3.pdf", "page-5.pdf", "pages-7-10.pdf"]);
  });

  it("appends -2 suffix on duplicate token name", () => {
    expect(
      planSplitFilenames([
        { original: "1-3", indices: [0, 1, 2] },
        { original: "1-3", indices: [0, 1, 2] },
      ]),
    ).toEqual(["pages-1-3.pdf", "pages-1-3-2.pdf"]);
  });

  it("appends -2, -3, -4 on triple duplicate", () => {
    expect(
      planSplitFilenames([
        { original: "5", indices: [4] },
        { original: "5", indices: [4] },
        { original: "5", indices: [4] },
        { original: "5", indices: [4] },
      ]),
    ).toEqual(["page-5.pdf", "page-5-2.pdf", "page-5-3.pdf", "page-5-4.pdf"]);
  });

  it("handles interleaved collisions independently", () => {
    expect(
      planSplitFilenames([
        { original: "1-3", indices: [0, 1, 2] },
        { original: "5", indices: [4] },
        { original: "1-3", indices: [0, 1, 2] },
        { original: "5", indices: [4] },
      ]),
    ).toEqual(["pages-1-3.pdf", "page-5.pdf", "pages-1-3-2.pdf", "page-5-2.pdf"]);
  });
});
