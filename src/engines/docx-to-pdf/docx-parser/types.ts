/**
 * Parsed-document model for the docx-to-pdf engine.
 *
 * Matches spec §3.3 (`docs/superpowers/specs/2026-05-02-docx-to-pdf-engine-design.md`).
 * Each XML file under `word/` is parsed into one of these structures; the
 * `parseDocx` orchestrator (Task 5) assembles them into a `ParsedDocx`.
 *
 * Unit conventions:
 * - All point-valued fields (page sizes, margins, font sizes, image dimensions)
 *   are in PostScript points (1/72 in). OOXML's wire formats are converted at
 *   parse time:
 *     - Twips → pt: divide by 20 (`<w:pgSz>`, `<w:pgMar>`, `<w:cols w:space>`, etc.).
 *     - Half-points → pt: divide by 2 (`<w:sz>` values, applied in run extraction
 *       in Task 5; the field on `Run.fontSizePt` is already in whole points).
 * - Hex colors are stored as 6-digit uppercase strings without leading `#`
 *   (e.g., `"FF0000"`); `colorHex === "auto"` from OOXML maps to `undefined`.
 *
 * Optionality conventions (matters under `exactOptionalPropertyTypes`):
 * - All `?:` fields are truly omitted from constructed objects when their
 *   underlying OOXML element is missing — never set to `undefined`. Use
 *   conditional spread when constructing.
 */

/* ------------------------------------------------------------------ */
/*   Top-level container                                              */
/* ------------------------------------------------------------------ */

/** Top-level result of `parseDocx`. Built by the orchestrator in Task 5. */
export type ParsedDocx = {
  sections: Section[];
  styles: Map<string, Style>;
  numbering: Map<string, NumberingDef>;
  fontTable: Map<string, FontInfo>;
  relationships: Map<string, RelationshipTarget>;
  /** footnote id → blocks. Populated in Task 5. */
  footnotes: Map<string, ParsedBlock[]>;
  /** endnote id → blocks. Populated in Task 5. */
  endnotes: Map<string, ParsedBlock[]>;
  /** header part name (e.g., `header1.xml`) → blocks. Populated in Task 5. */
  headers: Map<string, ParsedBlock[]>;
  /** footer part name → blocks. Populated in Task 5. */
  footers: Map<string, ParsedBlock[]>;
  /** zip-relative path → bytes + mime. Populated in Task 5. */
  media: Map<string, MediaAsset>;
  /** Skip-with-warning accumulator for unsupported features. Strings are
   * intended to be human-readable and concatenated by ResultList. */
  warnings: string[];
};

/* ------------------------------------------------------------------ */
/*   Sections                                                         */
/* ------------------------------------------------------------------ */

/**
 * A single body section with both its layout properties and its content.
 *
 * The body parser (Task 5) assembles this by combining `SectionProperties`
 * (from `parseSectionProperties` in `sections.ts`) with the blocks it walks
 * out of `word/document.xml`.
 */
export type Section = SectionProperties & {
  /** Body content for this section. Populated in Task 5. */
  blocks: ParsedBlock[];
};

/**
 * The section's layout properties — what `<w:sectPr>` describes by itself,
 * with no body content. Produced by `parseSectionProperties` in Task 4.
 */
export type SectionProperties = {
  pageSize: { widthPt: number; heightPt: number };
  pageMargins: { top: number; right: number; bottom: number; left: number };
  /** `count: 1` means single-column; `spaceBetween` is the gutter in pt. */
  columns: { count: number; spaceBetween: number };
  /** `<w:headerReference w:type="..." r:id="..."/>` entries by type. */
  headerRefs: SectionRefs;
  /** `<w:footerReference w:type="..." r:id="..."/>` entries by type. */
  footerRefs: SectionRefs;
};

/** Per-type relationship-id pointers for headers / footers within a section. */
export type SectionRefs = {
  default?: string;
  first?: string;
  even?: string;
};

/* ------------------------------------------------------------------ */
/*   Block-level content                                              */
/* ------------------------------------------------------------------ */

/** Body-level content. Walked in Task 5; consumed by the layout engine. */
export type ParsedBlock = Paragraph | Table | { kind: "skip-with-warning"; reason: string };

export type Paragraph = {
  kind: "paragraph";
  /** Resolves to a `Style` via the styles map; absent when paragraph has no
   * `<w:pStyle>` reference. */
  styleId?: string;
  alignment: "left" | "center" | "right" | "justify";
  /** List reference (`<w:numPr>`); absent for non-list paragraphs. */
  numPr?: { numId: string; ilvl: number };
  runs: Run[];
};

export type Run = {
  kind: "run";
  /** Joined `<w:t>` content for the run. Multiple `<w:t>` siblings are
   * concatenated; `<w:tab/>` becomes `\t`; soft `<w:br/>` (no type or
   * `w:type="textWrapping"`) becomes `\n`. Forced breaks
   * (`<w:br w:type="page|column"/>`) split the run instead — see
   * `pageBreakBefore` / `columnBreakBefore` on the next emitted run. */
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  /** Raw OOXML font name (e.g., "Calibri"). Substitution happens in the
   * layout pipeline via `fonts/substitution-map.ts`. */
  fontFamily?: string;
  /** Whole points. OOXML's `<w:sz w:val="24"/>` (24 half-points) is converted
   * to `12` here. */
  fontSizePt?: number;
  /** 6-digit uppercase hex without leading `#`. Absent when `<w:color>` is
   * `"auto"` or missing. */
  colorHex?: string;
  /** Relationship id for an external hyperlink (`<w:hyperlink r:id="...">`). */
  hyperlinkRel?: string;
  /** Internal-anchor target for a hyperlink (`<w:hyperlink w:anchor="...">`).
   * When both `r:id` and `w:anchor` are present, `hyperlinkRel` wins and a
   * warning is emitted; runs inside an anchor-only hyperlink carry this
   * field instead of `hyperlinkRel`. */
  hyperlinkAnchor?: string;
  /** Inline image reference; relationship id resolves into `media` map. */
  inlineImage?: { rel: string; widthPt: number; heightPt: number };
  /** Footnote reference id (looks up `ParsedDocx.footnotes`). */
  footnoteRef?: string;
  /** Endnote reference id (looks up `ParsedDocx.endnotes`). */
  endnoteRef?: string;
  /** Set when this run was emitted because the preceding `<w:br>` carried
   * `w:type="page"`. Layout (Tasks 7-9) honors this as a forced page break.
   * Soft line breaks (no type / `textWrapping`) remain as `\n` in `text`. */
  pageBreakBefore?: boolean;
  /** Set when this run was emitted because the preceding `<w:br>` carried
   * `w:type="column"`. Layout honors this as a forced column break in
   * multi-column sections. */
  columnBreakBefore?: boolean;
};

export type Table = {
  kind: "table";
  rows: TableRow[];
  /** Column widths in pt, derived from `<w:tblGrid><w:gridCol w:w="..."/>`. */
  columnWidthsPt: number[];
};

export type TableRow = {
  cells: TableCell[];
  /** Row height in pt, when `<w:trHeight>` is present. */
  heightPt?: number;
};

export type TableCell = {
  blocks: ParsedBlock[];
  /** Colspan; default 1. From `<w:gridSpan w:val="N"/>`. */
  gridSpan: number;
  /** Rowspan state per OOXML's vertical-merge model. `"start"` is the top
   * cell of a vertical merge; `"continue"` cells reuse the start cell's
   * content; `"none"` is a normal cell. */
  vMerge: "start" | "continue" | "none";
};

/* ------------------------------------------------------------------ */
/*   Styles                                                           */
/* ------------------------------------------------------------------ */

/**
 * The map key for the `<w:docDefaults>` synthesized "default" style.
 * Exported so consumers don't hard-code the magic string.
 */
export const DEFAULT_STYLE_KEY = "__default";

export type Style = {
  styleId: string;
  /** Style type — `paragraph`, `character`, `table`, or `numbering` per OOXML.
   * Unknown types are normalized to `"paragraph"` for safety. */
  type: "paragraph" | "character" | "table" | "numbering";
  /** Human-readable name (`<w:name w:val="..."/>`). May be omitted. */
  name?: string;
  /** Parent style id (`<w:basedOn w:val="..."/>`). Resolved at consumer-call
   * time via `resolveStyle` in `styles-xml.ts` (with a cycle guard). */
  basedOn?: string;
  /** Run-level defaults for this style (`<w:rPr>` inside `<w:style>`). */
  runProps: StyleRunProps;
  /** Paragraph-level defaults for this style (`<w:pPr>` inside `<w:style>`). */
  paragraphProps: StyleParagraphProps;
};

/** Run-level overrides a style applies. Mirrors the subset of `Run`
 * properties that styles can carry; everything optional. */
export type StyleRunProps = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  fontFamily?: string;
  fontSizePt?: number;
  colorHex?: string;
};

/** Paragraph-level overrides a style applies. */
export type StyleParagraphProps = {
  alignment?: "left" | "center" | "right" | "justify";
};

/* ------------------------------------------------------------------ */
/*   Numbering                                                        */
/* ------------------------------------------------------------------ */

export type NumberingDef = {
  /** OOXML `<w:num w:numId="..."/>`. */
  numId: string;
  /** Levels keyed by `ilvl` (0–8). Absent levels default to bullet decimal
   * during render; the parser never synthesizes a missing level. */
  levels: Map<number, NumberingLevel>;
};

export type NumberingLevel = {
  ilvl: number;
  format: NumberingFormat;
  /**
   * Marker template per OOXML — e.g. `"%1."` for `1.`, `"•"` for a bullet.
   * The layout engine substitutes `%N` with the rendered counter for level N.
   */
  text: string;
};

export type NumberingFormat =
  | "decimal"
  | "lowerLetter"
  | "upperLetter"
  | "lowerRoman"
  | "upperRoman"
  | "bullet";

/* ------------------------------------------------------------------ */
/*   Font table                                                       */
/* ------------------------------------------------------------------ */

export type FontInfo = {
  /** The font name as keyed in `word/fontTable.xml` (`<w:font w:name="..."/>`). */
  name: string;
  /** OOXML `<w:family>` value — `roman`, `swiss`, `modern`, `script`, `decorative`,
   * `auto`, etc. Informational only (the substitution map in Task 6 makes the
   * real bundled-font decision). */
  family?: FontFamilyKind;
};

export type FontFamilyKind = "roman" | "swiss" | "modern" | "script" | "decorative" | "auto";

/* ------------------------------------------------------------------ */
/*   Relationships                                                    */
/* ------------------------------------------------------------------ */

export type RelationshipTarget = {
  id: string;
  type: RelationshipType;
  /** Path/URL exactly as written in the .rels file. For internal images this
   * is typically `media/image1.png` (relative to `word/`); for hyperlinks it
   * is the absolute URL. */
  target: string;
  /** Target mode — `External` for hyperlinks/external resources; absent or
   * `"Internal"` for in-package targets. */
  targetMode?: "Internal" | "External";
};

/**
 * Subset of OOXML relationship types we care about. Anything outside this
 * union is normalized to `"other"` so consumers don't crash on exotic types
 * (themes, settings, footnotes, comments, etc.).
 */
export type RelationshipType =
  | "image"
  | "hyperlink"
  | "header"
  | "footer"
  | "footnotes"
  | "endnotes"
  | "styles"
  | "numbering"
  | "fontTable"
  | "other";

/* ------------------------------------------------------------------ */
/*   Media                                                            */
/* ------------------------------------------------------------------ */

export type MediaAsset = {
  /** Zip-relative path under `word/` (e.g., `word/media/image1.png`). */
  path: string;
  /** Sniffed/derived MIME type (`image/png`, `image/jpeg`, …). */
  mime: string;
  bytes: Uint8Array;
};
