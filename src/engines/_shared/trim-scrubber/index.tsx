"use client";

import { useEffect, useRef, useState } from "react";
import type { Peaks } from "./decode-peaks";

export type TrimScrubberProps = {
  source: File;
  modality: "audio" | "video";
  durationSec: number;
  startSec: number;
  endSec: number;
  onChange(start: number, end: number): void;
  disabled?: boolean;
  /** Optional injection point for tests; production callers pass a function
   * backed by WorkerHarness.runDecodePeaks. When omitted, the component
   * renders the flat hairline state and never decodes peaks. */
  decodePeaks?: (file: File, bucketCount: number) => Promise<Peaks>;
};

const BUCKET_COUNT = 512;
const ARROW_STEP_SEC = 1;
const SHIFT_ARROW_STEP_SEC = 10;

function formatTimestamp(sec: number): string {
  const safe = Number.isFinite(sec) && sec >= 0 ? sec : 0;
  const mm = Math.floor(safe / 60)
    .toString()
    .padStart(2, "0");
  const ss = Math.floor(safe % 60)
    .toString()
    .padStart(2, "0");
  const ms = Math.floor((safe % 1) * 1000)
    .toString()
    .padStart(3, "0");
  return `${mm}:${ss}.${ms}`;
}

export function TrimScrubber({
  source,
  modality,
  durationSec,
  startSec,
  endSec,
  onChange,
  disabled = false,
  decodePeaks,
}: TrimScrubberProps) {
  if (modality === "video") {
    throw new Error("video modality not implemented in phase 20 — deferred to phase 22");
  }

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [peaks, setPeaks] = useState<Peaks | null>(null);

  // Trigger peak decode whenever the source file changes (and a decoder is
  // injected). The OptionsPanel passes a worker-backed decoder; component
  // tests pass nothing so the bars area stays as a flat hairline.
  useEffect(() => {
    let cancelled = false;
    if (!decodePeaks) return;
    decodePeaks(source, BUCKET_COUNT).then(
      (p) => {
        if (!cancelled) setPeaks(p);
      },
      () => {
        if (!cancelled) setPeaks(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [source, decodePeaks]);

  // Render bars (or the hairline placeholder) on canvas whenever peaks change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "currentColor";
    if (!peaks) {
      // Hairline placeholder.
      ctx.fillRect(0, Math.floor(h / 2), w, 1);
      return;
    }
    const barW = w / peaks.max.length;
    const mid = h / 2;
    for (let i = 0; i < peaks.max.length; i++) {
      const x = Math.floor(i * barW);
      const top = Math.floor(mid - mid * (peaks.max[i] ?? 0));
      const bottom = Math.ceil(mid - mid * (peaks.min[i] ?? 0));
      ctx.fillRect(x, top, Math.max(1, Math.floor(barW)), Math.max(1, bottom - top));
    }
  }, [peaks]);

  const handleKeyDown = (which: "start" | "end") => (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    let delta = 0;
    if (e.key === "ArrowRight") {
      delta = e.shiftKey ? SHIFT_ARROW_STEP_SEC : ARROW_STEP_SEC;
    } else if (e.key === "ArrowLeft") {
      delta = -(e.shiftKey ? SHIFT_ARROW_STEP_SEC : ARROW_STEP_SEC);
    }
    if (delta === 0) return;
    e.preventDefault();
    let nextStart = startSec;
    let nextEnd = endSec;
    if (which === "start") {
      nextStart = Math.max(0, Math.min(endSec, startSec + delta));
    } else {
      nextEnd = Math.max(startSec, Math.min(durationSec, endSec + delta));
    }
    onChange(nextStart, nextEnd);
  };

  const startPct = durationSec > 0 ? (startSec / durationSec) * 100 : 0;
  const endPct = durationSec > 0 ? (endSec / durationSec) * 100 : 100;

  return (
    <div
      data-testid="trim-scrubber"
      className="relative my-3 w-full select-none border border-[var(--color-hairline)] bg-[var(--color-bg)] text-[var(--color-fg-strong)]"
    >
      <canvas ref={canvasRef} width={1024} height={96} className="block h-24 w-full" />
      {/* Selected region overlay */}
      <div
        className="pointer-events-none absolute inset-y-0 border-l border-r border-[var(--color-fg-strong)] bg-[color-mix(in_srgb,var(--color-fg-strong)_10%,transparent)]"
        style={{
          left: `${startPct}%`,
          width: `${Math.max(0, endPct - startPct)}%`,
        }}
        aria-hidden="true"
      />
      {/* Start handle */}
      <div
        role="slider"
        aria-label="trim start"
        aria-valuemin={0}
        aria-valuemax={durationSec}
        aria-valuenow={startSec}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={handleKeyDown("start")}
        className="absolute inset-y-0 w-px cursor-ew-resize bg-[var(--color-fg-strong)] outline-none focus:ring-2 focus:ring-[var(--color-fg-strong)]"
        style={{ left: `${startPct}%` }}
      >
        <span className="absolute left-1 top-full mt-1 whitespace-nowrap font-mono text-[var(--text-2xs)] uppercase text-[var(--color-fg-muted)]">
          {formatTimestamp(startSec)}
        </span>
      </div>
      {/* End handle */}
      <div
        role="slider"
        aria-label="trim end"
        aria-valuemin={0}
        aria-valuemax={durationSec}
        aria-valuenow={endSec}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={handleKeyDown("end")}
        className="absolute inset-y-0 w-px cursor-ew-resize bg-[var(--color-fg-strong)] outline-none focus:ring-2 focus:ring-[var(--color-fg-strong)]"
        style={{ left: `${endPct}%` }}
      >
        <span className="absolute right-1 top-full mt-1 whitespace-nowrap font-mono text-[var(--text-2xs)] uppercase text-[var(--color-fg-muted)]">
          {formatTimestamp(endSec)}
        </span>
      </div>
    </div>
  );
}
