"use client";

import type { OutputItem } from "@/engines/_shared/types";
import { download } from "@/lib/download";
import { useState } from "react";

type Props = {
  items: OutputItem[];
  archiveBasename?: string;
  archiveSuffix?: string;
};

export function ResultList({ items, archiveBasename, archiveSuffix }: Props) {
  const [zipBusy, setZipBusy] = useState(false);

  if (items.length === 0) return null;

  async function handleDownloadAllAsZip() {
    if (zipBusy) return;
    setZipBusy(true);
    try {
      const { buildZipBlob } = await import("@/engines/_shared/zip");
      const archiveName = `${archiveBasename ?? "output"}${archiveSuffix ?? ""}.zip`;
      const { filename, blob } = await buildZipBlob(items, archiveName);
      download(blob, filename);
    } finally {
      setZipBusy(false);
    }
  }

  return (
    <ul
      aria-label="Conversion results"
      className="mt-4 divide-y divide-[var(--color-hairline)] border border-[var(--color-hairline)]"
    >
      {items.length > 1 && (
        <li className="flex items-center justify-between bg-[var(--color-surface)] px-3 py-2 text-[var(--text-sm)]">
          <span className="text-[var(--color-fg-muted)] uppercase tracking-[0.1em] text-[var(--text-xs)]">
            {items.length} files
          </span>
          <button
            type="button"
            data-testid="download-all-zip"
            disabled={zipBusy}
            aria-label={`download all ${items.length} files as zip`}
            onClick={handleDownloadAllAsZip}
            className="border border-[var(--color-accent)] px-2 py-1 text-[var(--text-xs)] uppercase tracking-[0.1em] text-[var(--color-fg-strong)] hover:border-[var(--color-fg-strong)] disabled:border-[var(--color-fg-very-muted)] disabled:text-[var(--color-fg-very-muted)]"
          >
            {zipBusy ? "[ packing... ]" : `[ download all (${items.length}) as zip ]`}
          </button>
        </li>
      )}
      {items.map((item) => (
        <li key={item.filename} className="flex flex-col gap-1 px-3 py-2 text-[var(--text-sm)]">
          <div className="flex items-center justify-between">
            <span className="truncate text-[var(--color-fg)]" title={item.filename}>
              {item.filename}
            </span>
            <button
              type="button"
              aria-label={`download ${item.filename}`}
              onClick={() => download(item.blob, item.filename)}
              className="border border-[var(--color-hairline)] px-2 py-1 text-[var(--text-xs)] uppercase tracking-[0.1em] text-[var(--color-fg-strong)] hover:border-[var(--color-accent)]"
            >
              download
            </button>
          </div>
          {item.warnings !== undefined && item.warnings.length > 0 && (
            <span
              data-testid="output-warnings"
              className="text-[var(--text-xs)] text-[var(--color-fg-muted)]"
            >
              — {item.warnings.length} feature{item.warnings.length === 1 ? "" : "s"} unsupported:{" "}
              {item.warnings.slice(0, 3).join(", ")}
              {item.warnings.length > 3 ? ", …" : ""}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
