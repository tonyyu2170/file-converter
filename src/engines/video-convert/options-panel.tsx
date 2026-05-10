"use client";

import type { OptionsPanelProps } from "@/engines/_shared/types";
import {
  VIDEO_CONVERT_FORMATS,
  VIDEO_CONVERT_QUALITY_LEVELS,
  type VideoConvertOptions,
  type VideoConvertQuality,
} from "./options";

export function VideoConvertOptionsPanel({
  value,
  onChange,
}: OptionsPanelProps<VideoConvertOptions>) {
  return (
    <div
      data-testid="video-convert-options"
      className="mb-3 flex flex-wrap items-center gap-4 border border-[var(--color-hairline)] p-3 text-[var(--text-xs)]"
    >
      <fieldset className="flex items-center gap-2 border-0 p-0 m-0">
        <legend className="float-left mr-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
          format:
        </legend>
        <span className="inline-flex gap-3">
          {VIDEO_CONVERT_FORMATS.map((fmt) => (
            <label
              key={fmt}
              className="flex cursor-pointer items-center gap-1 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]"
            >
              <input
                type="radio"
                name="video-output-format"
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

      <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        quality:
        <select
          aria-label="quality"
          data-testid="quality-select"
          value={value.quality}
          onChange={(e) =>
            onChange({
              ...value,
              quality: e.target.value as VideoConvertQuality,
            })
          }
          className="border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-fg-strong)] uppercase"
        >
          {VIDEO_CONVERT_QUALITY_LEVELS.map((q) => (
            <option key={q} value={q}>
              {q}
            </option>
          ))}
        </select>
      </label>

      <p className="basis-full text-[var(--color-fg-very-muted)]">
        {"// this typically takes ~1 minute per minute of video."}
      </p>
    </div>
  );
}
