export function replaceExtension(originalName: string, newExtension: string): string {
  const ext = newExtension.startsWith(".") ? newExtension : `.${newExtension}`;
  const dot = originalName.lastIndexOf(".");
  if (dot <= 0) return `${originalName}${ext}`;
  return `${originalName.slice(0, dot)}${ext}`;
}

export function pageSuffixedName(originalName: string, page: number, newExtension: string): string {
  const ext = newExtension.startsWith(".") ? newExtension : `.${newExtension}`;
  const dot = originalName.lastIndexOf(".");
  const base = dot <= 0 ? originalName : originalName.slice(0, dot);
  return `${base}-page-${page}${ext}`;
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[ -<>:"/\\|?*]/g, "_").slice(0, 255);
}
