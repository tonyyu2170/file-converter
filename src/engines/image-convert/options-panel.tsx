"use client";

import type { OptionsPanelProps } from "@/engines/_shared/types";
import type { ImageConvertOptions, ImageConvertOutputFormat } from "./options";

const FORMATS: ImageConvertOutputFormat[] = ["png", "jpeg", "webp"];

export function ImageConvertOptionsPanel({
  value,
  onChange,
}: OptionsPanelProps<ImageConvertOptions>) {
  const showQuality = value.output !== null && value.output !== "png";

  return (
    <div
      data-testid="image-convert-options"
      className="mb-3 flex flex-wrap items-center gap-4 border border-[var(--color-hairline)] p-3 text-[var(--text-xs)]"
    >
      <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        output:
        <select
          data-testid="output-format"
          value={value.output ?? ""}
          onChange={(e) => {
            const next = e.target.value as ImageConvertOutputFormat | "";
            onChange({ ...value, output: next === "" ? null : next });
          }}
          className="border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-fg-strong)] uppercase"
        >
          <option value="">— select format —</option>
          {FORMATS.map((f) => (
            <option key={f} value={f}>
              {f.toUpperCase()}
            </option>
          ))}
        </select>
      </label>

      {showQuality && (
        <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
          quality:
          <input
            data-testid="quality-slider"
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={value.quality}
            onChange={(e) => onChange({ ...value, quality: Number.parseFloat(e.target.value) })}
            className="w-32"
          />
          <span data-testid="quality-value" className="tabular-nums text-[var(--color-fg-strong)]">
            {value.quality.toFixed(2)}
          </span>
        </label>
      )}
    </div>
  );
}
