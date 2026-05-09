"use client";

import type { OutputItem } from "@/engines/_shared/types";
import { download } from "@/lib/download";
import { formatBytes } from "@/lib/format-bytes";
import { useState } from "react";

type Props = {
  items: OutputItem[];
  archiveBasename?: string;
  archiveSuffix?: string;
  inputBytes?: number;
};

function basenameOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

function buildDedupeMap(items: ReadonlyArray<OutputItem>): string[] {
  const seen = new Map<string, number>();
  const out: string[] = [];
  for (const item of items) {
    const base = basenameOf(item.filename);
    const count = seen.get(base) ?? 0;
    if (count === 0) {
      out.push(base);
    } else {
      const dot = base.lastIndexOf(".");
      const stem = dot === -1 ? base : base.slice(0, dot);
      const ext = dot === -1 ? "" : base.slice(dot);
      out.push(`${stem}-${count}${ext}`);
    }
    seen.set(base, count + 1);
  }
  return out;
}

function formatDelta(input: number, output: number): string {
  if (input === 0) return "";
  const pct = Math.round(((output - input) / input) * 100);
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct}%`;
}

export function ResultList({ items, archiveBasename, archiveSuffix, inputBytes }: Props) {
  const [zipBusy, setZipBusy] = useState(false);

  if (items.length === 0) return null;

  const outputBytes = items.reduce((sum, it) => sum + it.blob.size, 0);
  const downloadNames = buildDedupeMap(items);

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
    <>
      {inputBytes !== undefined && (
        <div
          data-testid="size-delta"
          className="mt-4 flex items-center gap-2 text-[var(--text-xs)] uppercase tracking-[0.1em] text-[var(--color-fg-muted)]"
        >
          <span>
            in <span className="text-[var(--color-fg-strong)]">{formatBytes(inputBytes)}</span>
          </span>
          <span>→</span>
          <span>
            out <span className="text-[var(--color-fg-strong)]">{formatBytes(outputBytes)}</span>
          </span>
          {inputBytes > 0 && (
            <>
              <span>·</span>
              <span className="text-[var(--color-fg-strong)]">
                {formatDelta(inputBytes, outputBytes)}
              </span>
            </>
          )}
        </div>
      )}
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
        {items.map((item, i) => (
          <li key={item.filename} className="flex flex-col gap-1 px-3 py-2 text-[var(--text-sm)]">
            <div className="flex items-center justify-between">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="truncate text-[var(--color-fg)]" title={item.filename}>
                  {item.filename}
                </span>
                <span className="shrink-0 text-[var(--color-fg-muted)] text-[var(--text-xs)]">
                  {formatBytes(item.blob.size)}
                </span>
              </span>
              <button
                type="button"
                aria-label={`download ${item.filename}`}
                onClick={() => download(item.blob, downloadNames[i] ?? basenameOf(item.filename))}
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
    </>
  );
}
