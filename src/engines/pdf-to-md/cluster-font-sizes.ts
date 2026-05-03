export type FontSizeClassification = {
  body: number;
  headings: number[];
};

const HEADING_RATIO = 1.4;
const MAX_HEADING_LEVELS = 3;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function clusterFontSizes(sizes: number[]): FontSizeClassification {
  if (sizes.length === 0) return { body: 0, headings: [] };

  const rounded = sizes.map(round1);

  // Mode with smaller-value tiebreak: iterate sorted ascending and only
  // replace the running winner on a STRICTLY greater count, so the smaller
  // value wins ties (body text is usually smaller than headings).
  const sorted = [...rounded].sort((a, b) => a - b);
  const counts = new Map<number, number>();
  for (const s of sorted) counts.set(s, (counts.get(s) ?? 0) + 1);

  let bestValue = sorted[0] ?? 0;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      bestValue = value;
    }
  }
  const body = bestValue;

  const headingThreshold = body * HEADING_RATIO;
  const headingSet = new Set<number>();
  for (const s of rounded) {
    if (s >= headingThreshold) headingSet.add(s);
  }
  const headings = [...headingSet].sort((a, b) => b - a).slice(0, MAX_HEADING_LEVELS);

  return { body, headings };
}
