"use client";

import { TrimScrubber } from "@/engines/_shared/trim-scrubber";
import type { Peaks } from "@/engines/_shared/trim-scrubber/decode-peaks";
import { readMediaDurationSec } from "@/engines/_shared/trim-scrubber/duration";
import type { OptionsPanelProps } from "@/engines/_shared/types";
import { useCallback, useEffect, useState } from "react";
import { getAudioTrimHarness } from "./index";
import {
  AUDIO_TRIM_BITRATE_OPTIONS,
  AUDIO_TRIM_FORMATS,
  type AudioTrimFormat,
  type AudioTrimOptions,
  isLossyOutput,
} from "./options";

export function AudioTrimOptionsPanel({
  value,
  onChange,
  file,
}: OptionsPanelProps<AudioTrimOptions>) {
  const [durationSec, setDurationSec] = useState<number | null>(null);

  // Probe duration when a file is staged. Reset selection to [0, duration].
  // We deliberately exclude `value` and `onChange` so the probe fires once
  // per file, not on every option change while the user drags a handle.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fire once per file, not per option change
  useEffect(() => {
    let cancelled = false;
    if (!file) {
      setDurationSec(null);
      return;
    }
    setDurationSec(null);
    readMediaDurationSec(file, "audio").then(
      (d) => {
        if (cancelled) return;
        setDurationSec(d);
        onChange({ ...value, startSec: 0, endSec: d });
      },
      () => {
        if (cancelled) return;
        setDurationSec(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [file]);

  const decodePeaksThroughHarness = useCallback(
    async (f: File, bucketCount: number): Promise<Peaks> => {
      const harness = getAudioTrimHarness();
      return harness.runDecodePeaks(f, bucketCount);
    },
    [],
  );

  const showBitrate = isLossyOutput(value.outputFormat);

  return (
    <div
      data-testid="audio-trim-options"
      className="mb-3 flex flex-col gap-3 border border-[var(--color-hairline)] p-3 text-[var(--text-xs)]"
    >
      {/* Format + bitrate row */}
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
          output format:
          <select
            aria-label="output format"
            data-testid="audio-trim-format"
            value={value.outputFormat}
            onChange={(e) =>
              onChange({ ...value, outputFormat: e.target.value as AudioTrimFormat })
            }
            className="border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-fg-strong)] uppercase"
          >
            {AUDIO_TRIM_FORMATS.map((fmt) => (
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
              data-testid="audio-trim-bitrate"
              value={value.bitrate}
              onChange={(e) =>
                onChange({
                  ...value,
                  bitrate: Number(e.target.value) as (typeof AUDIO_TRIM_BITRATE_OPTIONS)[number],
                })
              }
              className="border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-fg-strong)] uppercase"
            >
              {AUDIO_TRIM_BITRATE_OPTIONS.map((kbps) => (
                <option key={kbps} value={kbps}>
                  {kbps} kbps
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* Scrubber appears only when both file and duration are known */}
      {file && durationSec !== null && durationSec > 0 && (
        <TrimScrubber
          source={file}
          modality="audio"
          durationSec={durationSec}
          startSec={value.startSec}
          endSec={value.endSec}
          onChange={(start, end) => onChange({ ...value, startSec: start, endSec: end })}
          decodePeaks={decodePeaksThroughHarness}
        />
      )}
    </div>
  );
}
