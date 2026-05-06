"use client";

import type { OptionsPanelProps } from "@/engines/_shared/types";
import {
  AUDIO_BITRATE_OPTIONS,
  type AudioConvertFormat,
  type AudioConvertOptions,
  isLossy,
} from "./options";

const FORMATS: AudioConvertFormat[] = ["mp3", "wav", "m4a", "flac"];

export function AudioConvertOptionsPanel({
  value,
  onChange,
}: OptionsPanelProps<AudioConvertOptions>) {
  const showBitrate = value.outputFormat !== null && isLossy(value.outputFormat);

  return (
    <div
      data-testid="audio-convert-options"
      className="mb-3 flex flex-wrap items-center gap-4 border border-[var(--color-hairline)] p-3 text-[var(--text-xs)]"
    >
      {/* Format radio group */}
      <fieldset className="flex items-center gap-2 border-0 p-0 m-0">
        <legend className="float-left mr-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
          format:
        </legend>
        <span className="inline-flex gap-3">
          {FORMATS.map((fmt) => (
            <label
              key={fmt}
              className="flex cursor-pointer items-center gap-1 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]"
            >
              <input
                type="radio"
                name="audio-output-format"
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

      {/* Bitrate select — only for lossy formats */}
      {showBitrate && (
        <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
          bitrate:
          <select
            aria-label="bitrate"
            data-testid="bitrate-select"
            value={value.bitrate}
            onChange={(e) =>
              onChange({
                ...value,
                bitrate: Number(e.target.value) as (typeof AUDIO_BITRATE_OPTIONS)[number],
              })
            }
            className="border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-fg-strong)] uppercase"
          >
            {AUDIO_BITRATE_OPTIONS.map((kbps) => (
              <option key={kbps} value={kbps}>
                {kbps} kbps
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
