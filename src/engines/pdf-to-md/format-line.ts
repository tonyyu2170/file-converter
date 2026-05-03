import type { FontSizeClassification } from "./cluster-font-sizes";
import { detectListMarker } from "./detect-list-marker";
import type { Line } from "./to-markdown";

function determineHeadingLevel(fontSize: number, headings: number[]): 1 | 2 | 3 | null {
  if (headings.length === 0) return null;

  const exactIndex = headings.indexOf(fontSize);
  if (exactIndex === 0) return 1;
  if (exactIndex === 1) return 2;
  if (exactIndex === 2) return 3;

  // headings is non-empty here. Smallest heading is the last entry; if the
  // line's fontSize is below it, this is body text.
  const smallest = headings[headings.length - 1];
  if (smallest === undefined || fontSize < smallest) return null;

  // Snap to the nearest heading by absolute distance; ties go to the larger
  // heading (earlier index in the descending-sorted list).
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < headings.length; i++) {
    const candidate = headings[i];
    if (candidate === undefined) continue;
    const distance = Math.abs(candidate - fontSize);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  if (bestIndex === 0) return 1;
  if (bestIndex === 1) return 2;
  return 3;
}

function applyEmphasis(text: string, bold: boolean, italic: boolean): string {
  if (bold && italic) return `***${text}***`;
  if (bold) return `**${text}**`;
  if (italic) return `*${text}*`;
  return text;
}

export function formatLine(line: Line, classification: FontSizeClassification): string {
  const marker = detectListMarker(line.text);
  if (marker.kind === "unordered") return `- ${marker.rest}`;
  if (marker.kind === "ordered") return `${marker.ordinal}. ${marker.rest}`;

  const level = determineHeadingLevel(line.fontSize, classification.headings);
  if (level !== null) return `${"#".repeat(level)} ${line.text}`;

  return applyEmphasis(line.text, line.bold, line.italic);
}
