"use client";

import { parseRangeTokens } from "@/engines/_shared/range";
import type { OptionsPanelProps } from "@/engines/_shared/types";
import type { PdfToImageOptions } from "./options";

// Use Number.MAX_SAFE_INTEGER as a sentinel pageCount so the parser surfaces
// syntax errors (commas, bare dashes, non-numeric tokens) but never reports
// "exceeds N" — bounds checks happen in the worker once the real pageCount
// is known after pdfjs-dist loads the document.
const SYNTAX_CHECK_PAGE_COUNT = Number.MAX_SAFE_INTEGER;

function syntaxErrorOf(input: string): string | undefined {
  const trimmed = input.trim();
  if (trimmed === "") return undefined;
  const result = parseRangeTokens(trimmed, SYNTAX_CHECK_PAGE_COUNT);
  return result.ok ? undefined : result.reason;
}

export function PdfToImageOptionsPanel({ value, onChange }: OptionsPanelProps<PdfToImageOptions>) {
  const error = syntaxErrorOf(value.rangeInput);
  return (
    <div
      data-testid="pdf-to-image-options"
      className="mb-3 flex flex-col gap-2 border border-[var(--color-hairline)] p-3 text-[var(--text-xs)]"
    >
      <div
        data-testid="pdf-to-image-format"
        className="flex items-center gap-3 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]"
      >
        <span>format:</span>
        <label className="flex items-center gap-1 text-[var(--color-fg)]">
          <input
            type="radio"
            name="pdf-to-image-format"
            value="png"
            checked={value.format === "png"}
            onChange={() => onChange({ ...value, format: "png" })}
          />
          PNG
        </label>
        <label className="flex items-center gap-1 text-[var(--color-fg)]">
          <input
            type="radio"
            name="pdf-to-image-format"
            value="jpeg"
            checked={value.format === "jpeg"}
            onChange={() => onChange({ ...value, format: "jpeg" })}
          />
          JPEG
        </label>
      </div>
      <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        scale:
        <select
          data-testid="pdf-to-image-scale"
          value={value.scale}
          onChange={(e) =>
            onChange({ ...value, scale: Number.parseInt(e.target.value, 10) as 1 | 2 | 3 })
          }
          className="border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1 font-mono text-[var(--color-fg)]"
        >
          <option value={1}>screen (1x)</option>
          <option value={2}>print (2x)</option>
          <option value={3}>high-res (3x)</option>
        </select>
      </label>
      {value.format === "jpeg" && (
        <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
          quality:
          <input
            type="range"
            data-testid="pdf-to-image-quality"
            min="1"
            max="100"
            value={value.jpegQuality}
            onChange={(e) =>
              onChange({ ...value, jpegQuality: Number.parseInt(e.target.value, 10) })
            }
            className="flex-1"
          />
          <span className="font-mono text-[var(--color-fg)]">{value.jpegQuality}</span>
        </label>
      )}
      <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        pages:
        <input
          type="text"
          data-testid="range-input"
          value={value.rangeInput}
          placeholder="e.g. 1-3, 5, 7- (empty = all)"
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
