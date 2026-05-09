// src/engines/data-convert/options-panel.tsx
"use client";

import type { OptionsPanelProps } from "@/engines/_shared/types";
import type { DataConvertFormat, DataConvertOptions } from "./options";

const FORMATS: DataConvertFormat[] = ["csv", "json", "yaml"];

export function DataConvertOptionsPanel({
  value,
  onChange,
}: OptionsPanelProps<DataConvertOptions>) {
  return (
    <div
      data-testid="data-convert-options"
      className="mb-3 flex flex-wrap items-center gap-4 border border-[var(--color-hairline)] p-3 text-[var(--text-xs)]"
    >
      <fieldset className="flex items-center gap-2 border-0 p-0 m-0">
        <legend className="float-left mr-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
          output:
        </legend>
        <span className="inline-flex gap-3">
          {FORMATS.map((fmt) => (
            <label
              key={fmt}
              className="flex cursor-pointer items-center gap-1 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]"
            >
              <input
                type="radio"
                name="data-convert-output-format"
                value={fmt}
                checked={value.outputFormat === fmt}
                onChange={() => onChange({ ...value, outputFormat: fmt })}
                className="accent-[var(--color-fg-strong)]"
              />
              {fmt}
            </label>
          ))}
        </span>
      </fieldset>
    </div>
  );
}
