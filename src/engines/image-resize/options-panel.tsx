"use client";

import type { OptionsPanelProps } from "@/engines/_shared/types";
import type { ImageResizeMode, ImageResizeOptions } from "./options";

export function ImageResizeOptionsPanel({
  value,
  onChange,
}: OptionsPanelProps<ImageResizeOptions>) {
  const isPx = value.mode === "px";
  const unit = isPx ? "px" : "%";

  return (
    <div
      data-testid="image-resize-options"
      className="mb-3 flex flex-wrap items-center gap-4 border border-[var(--color-hairline)] p-3 text-[var(--text-xs)]"
    >
      <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        mode:
        <select
          data-testid="resize-mode"
          value={value.mode}
          onChange={(e) => onChange({ ...value, mode: e.target.value as ImageResizeMode })}
          className="border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-fg-strong)] uppercase"
        >
          <option value="px">px</option>
          <option value="percent">%</option>
        </select>
      </label>

      <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        width:
        <input
          data-testid="resize-width"
          type="number"
          min={1}
          step={1}
          value={value.width}
          onChange={(e) => onChange({ ...value, width: Number.parseInt(e.target.value, 10) || 0 })}
          className="w-20 border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-fg-strong)]"
        />
        <span className="text-[var(--color-fg-strong)]">{unit}</span>
      </label>

      <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        height:
        <input
          data-testid="resize-height"
          type="number"
          min={1}
          step={1}
          value={value.height}
          disabled={value.lockAspectRatio}
          onChange={(e) => onChange({ ...value, height: Number.parseInt(e.target.value, 10) || 0 })}
          placeholder={value.lockAspectRatio ? "auto" : undefined}
          className="w-20 border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-fg-strong)] disabled:text-[var(--color-fg-very-muted)]"
        />
        <span
          className={
            value.lockAspectRatio
              ? "text-[var(--color-fg-very-muted)]"
              : "text-[var(--color-fg-strong)]"
          }
        >
          {unit}
        </span>
      </label>

      <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        <input
          data-testid="resize-lock-ratio"
          type="checkbox"
          checked={value.lockAspectRatio}
          onChange={(e) => onChange({ ...value, lockAspectRatio: e.target.checked })}
        />
        lock aspect ratio
      </label>

      <span data-testid="resize-heic-note" className="text-[var(--color-fg-very-muted)]">
        {"// heic outputs png"}
      </span>
    </div>
  );
}
