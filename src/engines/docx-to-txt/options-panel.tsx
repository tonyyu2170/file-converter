"use client";

import type { OptionsPanelProps } from "@/engines/_shared/types";
import type { DocxToTxtOptions, ParagraphJoin } from "./options";

export function DocxToTxtOptionsPanel({ value, onChange }: OptionsPanelProps<DocxToTxtOptions>) {
  return (
    <div
      data-testid="docx-to-txt-options"
      className="mb-3 flex flex-wrap items-center gap-4 border border-[var(--color-hairline)] p-3 text-[var(--text-xs)]"
    >
      <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        paragraph join:
        <select
          data-testid="paragraph-join"
          value={value.joinParagraphs}
          onChange={(e) => onChange({ ...value, joinParagraphs: e.target.value as ParagraphJoin })}
          className="border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-fg-strong)] uppercase"
        >
          <option value="double-newline">{"// blank line between paragraphs"}</option>
          <option value="single-newline">{"// single line"}</option>
        </select>
      </label>
    </div>
  );
}
