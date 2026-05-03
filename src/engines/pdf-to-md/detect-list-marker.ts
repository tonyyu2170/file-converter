export type ListMarker =
  | { kind: "unordered"; rest: string }
  | { kind: "ordered"; ordinal: number; rest: string }
  | { kind: "none" };

const UNORDERED_GLYPH = /^[•*\-–—]\s+(.*)$/;
const ORDERED = /^(\d+)[.)]\s+(.*)$/;
const LETTER_PAREN = /^[a-z]\)\s+(.*)$/;
const ROMAN_LOWER = /^[ivx]+\.\s+(.*)$/i;

export function detectListMarker(text: string): ListMarker {
  const trimmed = text.replace(/^\s+/, "");
  if (trimmed === "") return { kind: "none" };

  const u = UNORDERED_GLYPH.exec(trimmed);
  if (u) return { kind: "unordered", rest: u[1] ?? "" };

  const o = ORDERED.exec(trimmed);
  if (o) {
    const ordinal = Number.parseInt(o[1] ?? "0", 10);
    return { kind: "ordered", ordinal, rest: o[2] ?? "" };
  }

  const letter = LETTER_PAREN.exec(trimmed);
  if (letter) return { kind: "unordered", rest: letter[1] ?? "" };

  const roman = ROMAN_LOWER.exec(trimmed);
  if (roman) return { kind: "unordered", rest: roman[1] ?? "" };

  return { kind: "none" };
}
