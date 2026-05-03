import { clusterFontSizes } from "./cluster-font-sizes";
import { detectListMarker } from "./detect-list-marker";
import { formatLine } from "./format-line";

export type Line = {
  text: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  y: number;
};

export type Page = Line[];

// Locally declared until Task 3 introduces options.ts; Task 3 will reconcile
// by importing PdfToMdOptions from "./options" and removing this declaration.
export type PdfToMdOptions = {
  pageBreaks: "horizontal-rule" | "none";
};

const PARAGRAPH_GAP_RATIO = 1.5;

function isHeadingLine(line: Line, headings: number[]): boolean {
  if (headings.length === 0) return false;
  const smallest = headings[headings.length - 1];
  if (smallest === undefined) return false;
  return line.fontSize >= smallest;
}

function isListLine(line: Line): boolean {
  return detectListMarker(line.text).kind !== "none";
}

function renderPage(page: Page, classification: ReturnType<typeof clusterFontSizes>): string {
  if (page.length === 0) return "";

  // pdfjs Y origin is bottom-left; sort descending so output reads top-down.
  const sorted = [...page].sort((a, b) => b.y - a.y);

  type Block =
    | { kind: "paragraph"; text: string }
    | { kind: "heading"; text: string }
    | { kind: "list"; items: string[] };
  const blocks: Block[] = [];

  let currentParagraph: string[] = [];
  let currentList: string[] | null = null;
  let prev: Line | null = null;

  const flushParagraph = (): void => {
    if (currentParagraph.length > 0) {
      blocks.push({ kind: "paragraph", text: currentParagraph.join(" ") });
      currentParagraph = [];
    }
  };
  const flushList = (): void => {
    if (currentList !== null && currentList.length > 0) {
      blocks.push({ kind: "list", items: currentList });
    }
    currentList = null;
  };

  for (const line of sorted) {
    const formatted = formatLine(line, classification);
    const heading = isHeadingLine(line, classification.headings);
    const list = isListLine(line);

    // List precedence matches formatLine (which checks list before heading);
    // a heading-sized line that also has a list marker stays in the list block.
    if (list) {
      flushParagraph();
      if (currentList === null) currentList = [];
      currentList.push(formatted);
      prev = line;
      continue;
    }

    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "heading", text: formatted });
      prev = line;
      continue;
    }

    // body line: enforce list/heading boundaries before evaluating gap
    flushList();

    if (prev !== null) {
      const gap = prev.y - line.y;
      const threshold = PARAGRAPH_GAP_RATIO * Math.max(prev.fontSize, line.fontSize);
      if (gap > threshold) flushParagraph();
    }
    currentParagraph.push(formatted);
    prev = line;
  }

  flushParagraph();
  flushList();

  const parts = blocks.map((b) => (b.kind === "list" ? b.items.join("\n") : b.text));
  return parts.join("\n\n");
}

export function toMarkdown(pages: Page[], opts: PdfToMdOptions): string {
  const allSizes: number[] = [];
  for (const page of pages) {
    for (const line of page) allSizes.push(line.fontSize);
  }
  const classification = clusterFontSizes(allSizes);

  const rendered = pages
    .map((page) => renderPage(page, classification))
    .filter((s) => s.trim() !== "");
  if (rendered.length === 0) return "";

  const separator = opts.pageBreaks === "horizontal-rule" ? "\n\n---\n\n" : "\n\n";
  const joined = rendered.join(separator);
  return `${joined.replace(/\s+$/, "")}\n`;
}
