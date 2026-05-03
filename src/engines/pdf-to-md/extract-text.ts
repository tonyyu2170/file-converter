import type * as pdfjs from "pdfjs-dist";
import type { Line, Page } from "./to-markdown";

const Y_TOLERANCE = 2;
const BOLD_RE = /bold/i;
const ITALIC_RE = /italic|oblique/i;

// pdfjs-dist's top-level type entry doesn't re-export TextItem; derive it
// from the PDFPageProxy.getTextContent() return type instead of importing
// from the deep "pdfjs-dist/types/src/display/api" path.
type TextContentItem = Awaited<ReturnType<pdfjs.PDFPageProxy["getTextContent"]>>["items"][number];
type TextItem = Extract<TextContentItem, { str: string }>;

type WorkingItem = {
  text: string;
  fontSize: number;
  y: number;
  bold: boolean;
  italic: boolean;
};

type WorkingLine = {
  y: number;
  items: WorkingItem[];
};

function modeFontSize(items: WorkingItem[]): number {
  const sorted = [...items].sort((a, b) => a.fontSize - b.fontSize);
  const counts = new Map<number, number>();
  for (const it of sorted) counts.set(it.fontSize, (counts.get(it.fontSize) ?? 0) + 1);

  let best = sorted[0]?.fontSize ?? 0;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      best = value;
    }
  }
  return best;
}

function majority(items: WorkingItem[], pick: (it: WorkingItem) => boolean): boolean {
  if (items.length === 0) return false;
  let trueCount = 0;
  for (const it of items) {
    if (pick(it)) trueCount++;
  }
  return trueCount * 2 > items.length;
}

export async function extractTextFromPage(page: pdfjs.PDFPageProxy): Promise<Page> {
  const content = await page.getTextContent();
  const textItems = content.items.filter((item): item is TextItem => "str" in item);

  const lines: WorkingLine[] = [];
  for (const item of textItems) {
    const text = item.str;
    if (text === "") continue;
    const fontSize = Math.abs(item.transform[3]);
    const y = item.transform[5];
    const fontName = item.fontName;
    const working: WorkingItem = {
      text,
      fontSize,
      y,
      bold: BOLD_RE.test(fontName),
      italic: ITALIC_RE.test(fontName),
    };

    let matched = false;
    for (const line of lines) {
      if (Math.abs(line.y - y) <= Y_TOLERANCE) {
        line.items.push(working);
        matched = true;
        break;
      }
    }
    if (!matched) {
      lines.push({ y, items: [working] });
    }
  }

  const result: Line[] = [];
  for (const line of lines) {
    if (line.items.length === 0) continue;
    const text = line.items
      .map((it) => it.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text === "") continue;
    result.push({
      text,
      fontSize: modeFontSize(line.items),
      bold: majority(line.items, (it) => it.bold),
      italic: majority(line.items, (it) => it.italic),
      y: line.y,
    });
  }
  return result;
}
