"use client";

import { parseRangeTokens } from "@/engines/_shared/range";
import type { OptionsPanelProps } from "@/engines/_shared/types";
import type { PdfSplitOptions } from "./options";

// Use Number.MAX_SAFE_INTEGER as a sentinel pageCount so the parser surfaces
// syntax errors (commas, bare dashes, non-numeric tokens) but never reports
// "exceeds N" — bounds checks happen in the worker once the real pageCount
// is known after PDFDocument.load.
const SYNTAX_CHECK_PAGE_COUNT = Number.MAX_SAFE_INTEGER;

function syntaxErrorOf(input: string): string | undefined {
  const trimmed = input.trim();
  if (trimmed === "") return undefined; // engine.isReadyToConvert handles empty
  const result = parseRangeTokens(trimmed, SYNTAX_CHECK_PAGE_COUNT);
  return result.ok ? undefined : result.reason;
}

export function PdfSplitOptionsPanel({ value, onChange }: OptionsPanelProps<PdfSplitOptions>) {
  const error = syntaxErrorOf(value.rangeInput);
  return (
    <div
      data-testid="pdf-split-options"
      className="mb-3 flex flex-col gap-1 border border-[var(--color-hairline)] p-3 text-[var(--text-xs)]"
    >
      <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        pages:
        <input
          type="text"
          data-testid="range-input"
          value={value.rangeInput}
          placeholder="e.g. 1-3, 5, 7-"
          onChange={(e) => onChange({ ...value, rangeInput: e.target.value })}
          className="flex-1 border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1 font-mono text-[var(--color-fg)]"
        />
      </label>
      {error && (
        <span data-testid="range-syntax-error" className="text-[var(--color-accent)]">
          {error}
        </span>
      )}
    </div>
  );
}
