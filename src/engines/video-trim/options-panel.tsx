"use client";

import { TrimScrubber } from "@/engines/_shared/trim-scrubber";
import { readMediaDurationSec } from "@/engines/_shared/trim-scrubber/duration";
import type { OptionsPanelProps } from "@/engines/_shared/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { getVideoTrimHarness } from "./index";
import {
  containerSupportsCodecs,
  VIDEO_TRIM_CONTAINERS,
  type VideoTrimContainer,
  type VideoTrimOptions,
} from "./options";

type ProbeShape = {
  videoCodec: string | null;
  audioCodec: string | null;
};

export function VideoTrimOptionsPanel({
  value,
  onChange,
  file,
}: OptionsPanelProps<VideoTrimOptions>) {
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [probe, setProbe] = useState<ProbeShape | null>(null);

  // Keep refs current so async callbacks always read the latest value/onChange
  // even if options changed during the probe window.
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  });

  // Probe duration on the main thread (fast, doesn't need ffmpeg).
  useEffect(() => {
    let cancelled = false;
    if (!file) {
      setDurationSec(null);
      return;
    }
    setDurationSec(null);
    readMediaDurationSec(file, "video").then(
      (d) => {
        if (cancelled) return;
        setDurationSec(d);
        onChangeRef.current({ ...valueRef.current, startSec: 0, endSec: d });
      },
      () => {
        if (!cancelled) setDurationSec(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [file]);

  // Worker-backed probe for codec data (drives disabled state of dropdown).
  useEffect(() => {
    let cancelled = false;
    if (!file) {
      setProbe(null);
      return;
    }
    setProbe(null);
    getVideoTrimHarness()
      .runProbe(file)
      .then(
        (p) => {
          if (cancelled) return;
          setProbe({ videoCodec: p.videoCodec, audioCodec: p.audioCodec });
        },
        () => {
          if (!cancelled) setProbe(null);
        },
      );
    return () => {
      cancelled = true;
    };
  }, [file]);

  // Stable callback per spec §6.5: TrimScrubber's extractFrames prop
  // requires a stable reference (effect re-fires on identity change).
  const extractFramesThroughHarness = useCallback(
    async (f: File, count: number, heightPx: number) => {
      return getVideoTrimHarness().runExtractFrameStrip({ file: f, count, heightPx });
    },
    [],
  );

  return (
    <div
      data-testid="video-trim-options"
      className="mb-3 flex flex-col gap-3 border border-[var(--color-hairline)] p-3 text-[var(--text-xs)]"
    >
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
          output container:
          <select
            aria-label="output container"
            data-testid="video-trim-container"
            value={value.containerFormat}
            onChange={(e) =>
              onChange({
                ...value,
                containerFormat: e.target.value as VideoTrimContainer,
              })
            }
            className="border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-fg-strong)] uppercase"
          >
            {VIDEO_TRIM_CONTAINERS.map((fmt) => {
              const allowed =
                probe === null
                  ? fmt === "same"
                  : containerSupportsCodecs(
                      fmt,
                      probe.videoCodec,
                      probe.audioCodec,
                    );
              const title =
                probe !== null && !allowed
                  ? `${fmt.toUpperCase()} can't hold ${probe.videoCodec ?? "this video's codec"}` +
                    (probe.audioCodec ? ` / ${probe.audioCodec}` : "")
                  : undefined;
              return (
                <option key={fmt} value={fmt} disabled={!allowed} title={title}>
                  {fmt}
                </option>
              );
            })}
          </select>
        </label>
        {probe === null && (
          <span className="text-[var(--color-fg-very-muted)]">
            detecting codecs…
          </span>
        )}
      </div>

      {file && durationSec !== null && durationSec > 0 && (
        <TrimScrubber
          source={file}
          modality="video"
          durationSec={durationSec}
          startSec={value.startSec}
          endSec={value.endSec}
          onChange={(start, end) =>
            onChange({ ...value, startSec: start, endSec: end })
          }
          extractFrames={extractFramesThroughHarness}
        />
      )}
    </div>
  );
}
