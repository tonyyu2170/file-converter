const EDIT_SUFFIX = "-edited";

export function editedFilename(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "edited.pdf";
  // Strip trailing .pdf (case-insensitive)
  const lower = trimmed.toLowerCase();
  let base = trimmed;
  if (lower.endsWith(".pdf")) {
    base = trimmed.slice(0, -4);
  }
  if (!base) return "edited.pdf";
  if (base.toLowerCase().endsWith(EDIT_SUFFIX)) return `${base}.pdf`;
  return `${base}${EDIT_SUFFIX}.pdf`;
}
