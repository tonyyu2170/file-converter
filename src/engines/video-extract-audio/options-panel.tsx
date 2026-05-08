"use client";

import type { OptionsPanelProps } from "@/engines/_shared/types";
import { useEffect, useState } from "react";
import { getVideoExtractAudioHarness } from "./index";
import {
  AUDIO_BITRATE_OPTIONS,
  VIDEO_EXTRACT_AUDIO_FORMATS,
  type VideoExtractAudioFormat,
  type VideoExtractAudioOptions,
  isLossy,
} from "./options";

type ProbeState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "ready"; hasAudio: boolean }
  | { kind: "failed" };

export function VideoExtractAudioOptionsPanel({
  value,
  onChange,
  file,
}: OptionsPanelProps<VideoExtractAudioOptions>) {
  const [probeState, setProbeState] = useState<ProbeState>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    if (!file) {
      setProbeState({ kind: "idle" });
      return;
    }
    setProbeState({ kind: "pending" });
    getVideoExtractAudioHarness()
      .runProbe(file)
      .then(
        (p) => {
          if (cancelled) return;
          setProbeState({ kind: "ready", hasAudio: p.hasAudio });
        },
        () => {
          if (!cancelled) setProbeState({ kind: "failed" });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [file]);

  const showBitrate = value.outputFormat !== "same" && isLossy(value.outputFormat);

  const noAudio = probeState.kind === "ready" && !probeState.hasAudio;

  return (
    <div
      data-testid="video-extract-audio-options"
      className="mb-3 flex flex-col gap-3 border border-[var(--color-hairline)] p-3 text-[var(--text-xs)]"
    >
      {noAudio && (
        <div
          data-testid="video-extract-audio-no-audio-banner"
          role="alert"
          className="border border-[var(--color-fg-strong)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-fg-strong)] uppercase tracking-[0.1em]"
        >
          this video has no audio track
        </div>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
          output format:
          <select
            aria-label="output format"
            data-testid="video-extract-audio-format"
            value={value.outputFormat}
            disabled={noAudio}
            onChange={(e) =>
              onChange({
                ...value,
                outputFormat: e.target.value as VideoExtractAudioFormat,
              })
            }
            className="border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-fg-strong)] uppercase disabled:opacity-40"
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
              disabled={noAudio}
              onChange={(e) =>
                onChange({
                  ...value,
                  bitrate: Number(e.target.value) as (typeof AUDIO_BITRATE_OPTIONS)[number],
                })
              }
              className="border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-fg-strong)] uppercase disabled:opacity-40"
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
