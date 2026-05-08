"use client";

import type { OptionsPanelProps } from "@/engines/_shared/types";
import type { ImageToTextOptions, ImageToTextOutputFormat } from "./options";

export function ImageToTextOptionsPanel({
  value,
  onChange,
}: OptionsPanelProps<ImageToTextOptions>) {
  return (
    <div
      data-testid="image-to-text-options"
      className="mb-3 flex flex-col gap-2 border border-[var(--color-hairline)] p-3 text-[var(--text-xs)]"
    >
      <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        output format:
        <select
          aria-label="output format"
          data-testid="output-format-select"
          value={value.outputFormat}
          onChange={(e) =>
            onChange({
              ...value,
              outputFormat: e.target.value as ImageToTextOutputFormat,
            })
          }
          className="border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-fg-strong)] uppercase"
        >
          <option value="txt">Plain text (.txt)</option>
          <option value="json-with-bboxes">JSON with bounding boxes (.json)</option>
        </select>
      </label>
      <p className="text-[var(--color-fg-muted)] tracking-[0.05em]">
        ⓘ Best on scanned documents and screenshots; lower quality on photos.
      </p>
    </div>
  );
}
