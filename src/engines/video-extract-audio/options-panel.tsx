"use client";

import type { AudioFormat } from "@/engines/_shared/audio/format";
import type { OptionsPanelProps } from "@/engines/_shared/types";
import {
  AUDIO_BITRATE_OPTIONS,
  isLossy,
  type VideoExtractAudioFormat,
  type VideoExtractAudioOptions,
  VIDEO_EXTRACT_AUDIO_FORMATS,
} from "./options";

export function VideoExtractAudioOptionsPanel({
  value,
  onChange,
}: OptionsPanelProps<VideoExtractAudioOptions>) {
  const showBitrate =
    value.outputFormat !== "same" &&
    isLossy(value.outputFormat as AudioFormat);

  return (
    <div
      data-testid="video-extract-audio-options"
      className="mb-3 flex flex-col gap-3 border border-[var(--color-hairline)] p-3 text-[var(--text-xs)]"
    >
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
          output format:
          <select
            aria-label="output format"
            data-testid="video-extract-audio-format"
            value={value.outputFormat}
            onChange={(e) =>
              onChange({
                ...value,
                outputFormat: e.target.value as VideoExtractAudioFormat,
              })
            }
            className="border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-fg-strong)] uppercase"
          >
            {VIDEO_EXTRACT_AUDIO_FORMATS.map((fmt) => (
              <option key={fmt} value={fmt}>
                {fmt}
              </option>
            ))}
          </select>
        </label>

        {showBitrate && (
          <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
            bitrate:
            <select
              aria-label="bitrate"
              data-testid="video-extract-audio-bitrate"
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
    </div>
  );
}
