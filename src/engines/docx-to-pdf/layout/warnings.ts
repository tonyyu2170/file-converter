/**
 * Small helpers for the orchestrator's warning aggregation.
 *
 * Layout primitives (paragraph, lists, tables, multi-column) accumulate
 * structured strings into `LayoutDeps.warnings`. Several of them — most
 * commonly the "multi-column section unbalanced-by-design" notice — can
 * fire repeatedly across pages with the exact same wording. The
 * orchestrator de-dupes these before merging into the parser's
 * pre-existing `ParsedDocx.warnings` so the user-visible result-list line
 * doesn't repeat itself.
 *
 * The helpers in this module are intentionally tiny — they centralize the
 * dedupe rule so any future warning-aggregation tweak (e.g., capping
 * length, applying ordering, prefixing) lives here rather than at every
 * call site.
 */

/**
 * Return a copy of `warnings` with consecutive and non-consecutive
 * duplicates collapsed to a single occurrence (preserving first-seen
 * order). Empty input returns an empty array.
 */
export function dedupe(warnings: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of warnings) {
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

/**
 * Build the standard "image skipped" warning string. Centralized so the
 * exact wording is consistent across all sites that decide an image
 * couldn't be embedded (corrupt bytes, unsupported format, etc.).
 */
export function imageSkippedWarning(path: string, reason: string): string {
  return `image skipped: ${path} (${reason})`;
}

/**
 * Build the standard "footnote body too tall to reserve" warning. The
 * orchestrator's pre-reservation step caps reserved height at half the
 * page body to avoid pathological reservations from runaway footnotes.
 */
export function footnoteReservationCappedWarning(): string {
  return "footnote area exceeds 50% of page body — content may overlap with footnotes";
}
