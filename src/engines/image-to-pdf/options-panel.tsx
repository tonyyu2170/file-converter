"use client";

import type { OptionsPanelProps } from "@/engines/_shared/types";
import type { ImageToPdfOptions, ImageToPdfPaperSize } from "./options";

const PAPERS: ImageToPdfPaperSize[] = ["letter", "a4"];

export function ImageToPdfOptionsPanel({ value, onChange }: OptionsPanelProps<ImageToPdfOptions>) {
  return (
    <div
      data-testid="image-to-pdf-options"
      className="mb-3 flex flex-wrap items-center gap-4 border border-[var(--color-hairline)] p-3 text-[var(--text-xs)]"
    >
      <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        paper:
        <select
          data-testid="paper-size"
          value={value.paper}
          onChange={(e) => onChange({ ...value, paper: e.target.value as ImageToPdfPaperSize })}
          className="border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-fg-strong)] uppercase"
        >
          {PAPERS.map((p) => (
            <option key={p} value={p}>
              {p.toUpperCase()}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
