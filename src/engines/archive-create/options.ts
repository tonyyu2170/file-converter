export type ArchiveCreateFormat = "zip" | "tar.gz";

export type ArchiveCreateOptions = {
  outputFormat: ArchiveCreateFormat;
  /** User-edited base name (no extension). */
  filename: string;
};

export const FILENAME_REGEX = /^[A-Za-z0-9._-]+$/;
export const FILENAME_MAX_LEN = 100;

export function defaultArchiveBasename(now: Date = new Date()): string {
  const yyyy = now.getFullYear().toString().padStart(4, "0");
  const mm = (now.getMonth() + 1).toString().padStart(2, "0");
  const dd = now.getDate().toString().padStart(2, "0");
  const HH = now.getHours().toString().padStart(2, "0");
  const MM = now.getMinutes().toString().padStart(2, "0");
  return `archive-${yyyy}${mm}${dd}-${HH}${MM}`;
}

export function defaultOptions(): ArchiveCreateOptions {
  return { outputFormat: "zip", filename: defaultArchiveBasename() };
}

// Re-export for engine.defaultOptions; assigned at module load so the
// timestamp pins to "page-open time", not "every render".
export const defaultArchiveCreateOptions: ArchiveCreateOptions = defaultOptions();

export function extensionFor(fmt: ArchiveCreateFormat): string {
  return fmt === "zip" ? "zip" : "tar.gz";
}

export function validateFilename(name: string): { ok: true } | { ok: false; reason: string } {
  if (name.length === 0) return { ok: false, reason: "filename required" };
  if (name.length > FILENAME_MAX_LEN) {
    return { ok: false, reason: `filename too long (max ${FILENAME_MAX_LEN})` };
  }
  if (!FILENAME_REGEX.test(name)) {
    return {
      ok: false,
      reason: "letters, digits, dots, dashes, underscores only",
    };
  }
  return { ok: true };
}
