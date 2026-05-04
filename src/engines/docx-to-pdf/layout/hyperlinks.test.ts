import type { RelationshipTarget } from "@/engines/_shared/docx";
import { describe, expect, it } from "vitest";
import { type MockPage, makeMockPage } from "./_test-helpers";
import { attachLinkAnnotation, computeLinkRect } from "./hyperlinks";

function relMap(
  entries: Array<[string, RelationshipTarget]> = [],
): Map<string, RelationshipTarget> {
  return new Map(entries);
}

function externalRel(id: string, url: string): [string, RelationshipTarget] {
  return [id, { id, type: "hyperlink", target: url, targetMode: "External" }];
}

function internalRel(id: string, target: string): [string, RelationshipTarget] {
  return [id, { id, type: "hyperlink", target, targetMode: "Internal" }];
}

/* ---------- computeLinkRect ---------- */

describe("computeLinkRect", () => {
  it("builds [llx, lly, urx, ury] from baseline + width + height", () => {
    const rect = computeLinkRect(100, 700, 50, 12);
    // descent = 12 * 0.2 = 2.4; ascent = 12 * 0.8 = 9.6.
    expect(rect[0]).toBeCloseTo(100); // llx
    expect(rect[1]).toBeCloseTo(700 - 2.4); // lly
    expect(rect[2]).toBeCloseTo(150); // urx = x + width
    expect(rect[3]).toBeCloseTo(700 + 9.6); // ury
  });

  it("scales descent/ascent linearly with height", () => {
    const small = computeLinkRect(0, 0, 10, 10);
    const big = computeLinkRect(0, 0, 10, 20);
    // Big rect should span twice the vertical range of small.
    const smallV = small[3] - small[1];
    const bigV = big[3] - big[1];
    expect(bigV).toBeCloseTo(2 * smallV);
  });
});

/* ---------- attachLinkAnnotation: external URL ---------- */

describe("attachLinkAnnotation — external URL", () => {
  it("emits a URI action annotation for a resolved external rel", () => {
    const page = makeMockPage();
    const rels = relMap([externalRel("rId1", "https://example.com")]);
    const result = attachLinkAnnotation(page, 100, 700, 50, 12, { rel: "rId1" }, rels);
    expect(result.kind).toBe("uri");
    if (result.kind !== "uri") throw new Error("expected uri");
    expect(result.url).toBe("https://example.com");
    expect((page as MockPage).__annotations.length).toBe(1);
    const annot = (page as MockPage).__annotations[0];
    expect(annot?.dict.Subtype).toBe("Link");
    expect(annot?.dict.A?.S).toBe("URI");
  });

  it("rect has correct position", () => {
    const page = makeMockPage();
    const rels = relMap([externalRel("r1", "https://example.com")]);
    attachLinkAnnotation(page, 100, 700, 50, 12, { rel: "r1" }, rels);
    const annot = (page as MockPage).__annotations[0];
    expect(annot?.rect[0]).toBeCloseTo(100);
    expect(annot?.rect[2]).toBeCloseTo(150);
  });

  it("supports mailto: URLs", () => {
    const page = makeMockPage();
    const rels = relMap([externalRel("r1", "mailto:tony@example.com")]);
    const result = attachLinkAnnotation(page, 0, 0, 50, 12, { rel: "r1" }, rels);
    expect(result.kind).toBe("uri");
  });
});

/* ---------- attachLinkAnnotation: anchor ---------- */

describe("attachLinkAnnotation — internal anchor", () => {
  it("emits a Dest annotation for an anchor declared in bookmarks", () => {
    const page = makeMockPage();
    const bookmarks = new Set(["intro"]);
    const result = attachLinkAnnotation(
      page,
      0,
      0,
      50,
      12,
      { anchor: "intro" },
      relMap(),
      bookmarks,
    );
    expect(result.kind).toBe("dest");
    if (result.kind !== "dest") throw new Error("expected dest");
    expect(result.anchor).toBe("intro");
    const annot = (page as MockPage).__annotations[0];
    expect(annot?.dict.Dest).toBeDefined();
  });

  it("skips with 'anchor not found' when anchor is missing from bookmarks", () => {
    const page = makeMockPage();
    const bookmarks = new Set(["other"]);
    const result = attachLinkAnnotation(
      page,
      0,
      0,
      50,
      12,
      { anchor: "missing" },
      relMap(),
      bookmarks,
    );
    expect(result.kind).toBe("skipped");
    if (result.kind !== "skipped") throw new Error("expected skipped");
    expect(result.reason).toBe("anchor not found: missing");
    expect((page as MockPage).__annotations.length).toBe(0);
  });

  it("treats an empty bookmarks set as 'no anchors known' (defensive miss)", () => {
    // Defensive: an empty set means we never collected any bookmarks, which
    // is operationally identical to "the anchor isn't declared". Spec §10
    // requires plain-text fallback + warning in that case.
    const page = makeMockPage();
    const result = attachLinkAnnotation(
      page,
      0,
      0,
      50,
      12,
      { anchor: "intro" },
      relMap(),
      new Set(),
    );
    expect(result.kind).toBe("skipped");
    if (result.kind !== "skipped") throw new Error("expected skipped");
    expect(result.reason).toContain("anchor not found");
  });

  it("defaults bookmarks parameter to empty set (back-compat for callers)", () => {
    // Caller omits the optional `bookmarks` arg → treated as empty set,
    // which means anchor lookups always miss. This protects existing
    // call-sites that haven't been threaded through the bookmarks plumbing
    // (none in production, but defensive).
    const page = makeMockPage();
    const result = attachLinkAnnotation(page, 0, 0, 50, 12, { anchor: "intro" }, relMap());
    expect(result.kind).toBe("skipped");
  });
});

/* ---------- attachLinkAnnotation: failures ---------- */

describe("attachLinkAnnotation — resolution failures", () => {
  it("skips with a warning when rel does not resolve", () => {
    const page = makeMockPage();
    const result = attachLinkAnnotation(page, 0, 0, 50, 12, { rel: "missing" }, relMap());
    expect(result.kind).toBe("skipped");
    if (result.kind !== "skipped") throw new Error("expected skipped");
    expect(result.reason).toContain("missing");
    expect((page as MockPage).__annotations.length).toBe(0);
  });

  it("skips with a warning when rel resolves but is internal-mode", () => {
    const page = makeMockPage();
    const rels = relMap([internalRel("r1", "header1.xml")]);
    const result = attachLinkAnnotation(page, 0, 0, 50, 12, { rel: "r1" }, rels);
    expect(result.kind).toBe("skipped");
    if (result.kind !== "skipped") throw new Error("expected skipped");
    expect(result.reason).toContain("internal");
  });

  it("skips when neither rel nor anchor provided", () => {
    const page = makeMockPage();
    const result = attachLinkAnnotation(page, 0, 0, 50, 12, {}, relMap());
    expect(result.kind).toBe("skipped");
  });

  it("skips zero-size rect", () => {
    const page = makeMockPage();
    const rels = relMap([externalRel("r1", "https://x.com")]);
    const r1 = attachLinkAnnotation(page, 0, 0, 0, 12, { rel: "r1" }, rels);
    const r2 = attachLinkAnnotation(page, 0, 0, 50, 0, { rel: "r1" }, rels);
    expect(r1.kind).toBe("skipped");
    expect(r2.kind).toBe("skipped");
  });

  it("rel takes precedence over anchor when both are set and rel resolves", () => {
    const page = makeMockPage();
    const rels = relMap([externalRel("r1", "https://example.com")]);
    const result = attachLinkAnnotation(page, 0, 0, 50, 12, { rel: "r1", anchor: "intro" }, rels);
    expect(result.kind).toBe("uri");
  });
});

/* ---------- runs.ts integration via drawRunSpan ---------- */
// (Lightweight smoke — full coverage of drawRunSpan is in runs.test.ts.)

describe("hyperlink integration via drawRunSpan", () => {
  it("attaches an annotation when a hyperlink run is drawn", async () => {
    const { drawRunSpan } = await import("./runs");
    const { makeColumnContext } = await import("./_test-helpers");
    const ctx = makeColumnContext({ yPt: 700 });
    ctx.relationships = relMap([externalRel("r1", "https://example.com")]);
    drawRunSpan(
      ctx,
      {
        kind: "run",
        text: "click",
        bold: false,
        italic: false,
        underline: false,
        strike: false,
        hyperlinkRel: "r1",
      },
      "click",
      100,
      650,
    );
    expect((ctx.page as MockPage).__annotations.length).toBe(1);
  });

  it("does NOT attach an annotation when relationships map is missing", async () => {
    const { drawRunSpan } = await import("./runs");
    const { makeColumnContext } = await import("./_test-helpers");
    const ctx = makeColumnContext({ yPt: 700 });
    drawRunSpan(
      ctx,
      {
        kind: "run",
        text: "click",
        bold: false,
        italic: false,
        underline: false,
        strike: false,
        hyperlinkRel: "r1",
      },
      "click",
      100,
      650,
    );
    expect((ctx.page as MockPage).__annotations.length).toBe(0);
  });

  it("does NOT attach an annotation for plain (non-hyperlink) runs", async () => {
    const { drawRunSpan } = await import("./runs");
    const { makeColumnContext } = await import("./_test-helpers");
    const ctx = makeColumnContext({ yPt: 700 });
    ctx.relationships = relMap([externalRel("r1", "https://example.com")]);
    drawRunSpan(
      ctx,
      {
        kind: "run",
        text: "plain",
        bold: false,
        italic: false,
        underline: false,
        strike: false,
      },
      "plain",
      100,
      650,
    );
    expect((ctx.page as MockPage).__annotations.length).toBe(0);
  });

  it("attaches a Dest annotation when anchor is declared in ctx.bookmarks", async () => {
    const { drawRunSpan } = await import("./runs");
    const { makeColumnContext } = await import("./_test-helpers");
    const ctx = makeColumnContext({ yPt: 700 });
    ctx.relationships = relMap();
    ctx.bookmarks = new Set(["intro"]);
    drawRunSpan(
      ctx,
      {
        kind: "run",
        text: "click",
        bold: false,
        italic: false,
        underline: false,
        strike: false,
        hyperlinkAnchor: "intro",
      },
      "click",
      100,
      650,
    );
    expect((ctx.page as MockPage).__annotations.length).toBe(1);
  });

  it("skips and pushes a warning when anchor is missing from ctx.bookmarks", async () => {
    const { drawRunSpan } = await import("./runs");
    const { makeColumnContext } = await import("./_test-helpers");
    const ctx = makeColumnContext({ yPt: 700 });
    ctx.relationships = relMap();
    ctx.bookmarks = new Set(["something-else"]);
    ctx.warnings = [];
    drawRunSpan(
      ctx,
      {
        kind: "run",
        text: "click",
        bold: false,
        italic: false,
        underline: false,
        strike: false,
        hyperlinkAnchor: "missing",
      },
      "click",
      100,
      650,
    );
    expect((ctx.page as MockPage).__annotations.length).toBe(0);
    expect(ctx.warnings).toEqual(["anchor not found: missing"]);
  });
});
