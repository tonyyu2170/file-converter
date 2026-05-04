// SI thresholds (1000), matching macOS Finder. KB/MB/GB show 1 decimal when
// the value is under 10 (e.g., "4.2 MB"), integer otherwise (e.g., "512 MB").
// Trailing ".0" is stripped so 1024 -> "1 KB", not "1.0 KB".
const UNITS = ["KB", "MB", "GB", "TB"] as const;

function formatScaled(scaled: number): string {
  if (scaled < 10) {
    return (Math.round(scaled * 10) / 10).toString();
  }
  return `${Math.round(scaled)}`;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`formatBytes: invalid value ${n}`);
  }
  if (n === 0) return "0 B";
  if (n < 1000) return `${Math.round(n)} B`;

  let scaled = n / 1000;
  let unitIdx = 0;
  while (scaled >= 1000 && unitIdx < UNITS.length - 1) {
    scaled /= 1000;
    unitIdx++;
  }
  // After scaling, rounding can still produce "1000" (e.g., 999_500 B -> 999.5 KB
  // rounds to 1000 KB). Bump to the next unit until the rendered value fits.
  let result = formatScaled(scaled);
  while (result === "1000" && unitIdx < UNITS.length - 1) {
    scaled /= 1000;
    unitIdx++;
    result = formatScaled(scaled);
  }
  return `${result} ${UNITS[unitIdx]}`;
}
