"use client";

import type { OptionsPanelProps } from "@/engines/_shared/types";
import type { PdfToMdOptions } from "./options";

export function PdfToMdOptionsPanel({ value, onChange }: OptionsPanelProps<PdfToMdOptions>) {
  return (
    <div
      data-testid="pdf-to-md-options"
      className="mb-3 flex flex-col gap-2 border border-[var(--color-hairline)] p-3 text-[var(--text-xs)]"
    >
      <fieldset className="flex items-center gap-3" data-testid="pdf-to-md-page-breaks">
        <legend className="uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
          page breaks:
        </legend>
        <label className="flex items-center gap-1 text-[var(--color-fg)]">
          <input
            type="radio"
            name="pdf-to-md-page-breaks"
            value="horizontal-rule"
            checked={value.pageBreaks === "horizontal-rule"}
            onChange={() => onChange({ ...value, pageBreaks: "horizontal-rule" })}
          />
          horizontal rule
        </label>
        <label className="flex items-center gap-1 text-[var(--color-fg)]">
          <input
            type="radio"
            name="pdf-to-md-page-breaks"
            value="none"
            checked={value.pageBreaks === "none"}
            onChange={() => onChange({ ...value, pageBreaks: "none" })}
          />
          none
        </label>
      </fieldset>
      <p data-testid="pdf-to-md-limitations" className="text-[var(--color-fg-very-muted)]">
        {"// best-effort heuristic — multi-column / tables / forms degrade gracefully"}
      </p>
    </div>
  );
}
