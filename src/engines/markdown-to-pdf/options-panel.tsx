"use client";

import type { PdfPageSize } from "@/engines/_shared/pdf-page-setup";
import type { OptionsPanelProps } from "@/engines/_shared/types";
import type { MarkdownToPdfOptions } from "./options";

const PAGE_SIZE_LABELS: Record<PdfPageSize, string> = {
  letter: "letter (8.5 × 11 in)",
  a4: "a4 (210 × 297 mm)",
  legal: "legal (8.5 × 14 in)",
};

export function MarkdownToPdfOptionsPanel({
  value,
  onChange,
}: OptionsPanelProps<MarkdownToPdfOptions>) {
  return (
    <div
      data-testid="markdown-to-pdf-options"
      className="mb-3 flex flex-wrap items-center gap-4 border border-[var(--color-hairline)] p-3 text-[var(--text-xs)]"
    >
      <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        page size:
        <select
          data-testid="page-size"
          value={value.pageSize}
          onChange={(e) => onChange({ ...value, pageSize: e.target.value as PdfPageSize })}
          className="border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-fg-strong)] uppercase"
        >
          {(Object.keys(PAGE_SIZE_LABELS) as PdfPageSize[]).map((size) => (
            <option key={size} value={size}>
              {PAGE_SIZE_LABELS[size]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
