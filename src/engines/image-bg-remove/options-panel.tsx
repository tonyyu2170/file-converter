"use client";

import type { OptionsPanelProps } from "@/engines/_shared/types";
import { useState } from "react";
import { HEX_PATTERN, type ImageBgRemoveOptions, clampOptions } from "./options";

const PRESETS: Array<{
  key: "white" | "black" | "transparent";
  color: string;
  isTransparent?: boolean;
}> = [
  { key: "white", color: "#ffffff" },
  { key: "black", color: "#000000" },
  { key: "transparent", color: "transparent", isTransparent: true },
];

export function ImageBgRemoveOptionsPanel({
  value,
  onChange,
}: OptionsPanelProps<ImageBgRemoveOptions>) {
  const [hexDraft, setHexDraft] = useState(value.bgColor);

  const update = (next: ImageBgRemoveOptions) => onChange(clampOptions(next));
  const showQuality = value.outputFormat === "jpeg";

  return (
    <div
      data-testid="image-bg-remove-options"
      className="mb-3 flex flex-wrap items-center gap-4 border border-[var(--color-hairline)] p-3 text-[var(--text-xs)]"
    >
      {/* BG mode segmented */}
      <span className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        bg:
        <span className="inline-flex border border-[var(--color-hairline)]">
          {(["transparent", "solid"] as const).map((m, i) => (
            <button
              key={m}
              type="button"
              data-testid={`bg-mode-${m}`}
              onClick={() => update({ ...value, bgMode: m })}
              className={`px-2 py-1 uppercase tracking-[0.1em] ${
                value.bgMode === m
                  ? "bg-[var(--color-fg-strong)] text-[var(--color-bg)]"
                  : "text-[var(--color-fg-muted)]"
              } ${i > 0 ? "border-l border-[var(--color-hairline)]" : ""}`}
            >
              {m}
            </button>
          ))}
        </span>
      </span>

      {/* Presets */}
      <span className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        presets:
        <span className="inline-flex gap-1">
          {PRESETS.map((p) => {
            const disabled = p.isTransparent && value.outputFormat === "jpeg";
            return (
              <button
                key={p.key}
                type="button"
                aria-label={p.key}
                data-testid={`preset-${p.key}`}
                disabled={disabled}
                onClick={() => {
                  if (p.isTransparent) update({ ...value, bgMode: "transparent" });
                  else update({ ...value, bgMode: "solid", bgColor: p.color });
                }}
                className="h-[22px] w-[22px] border border-[var(--color-hairline)] disabled:opacity-30"
                style={
                  p.isTransparent
                    ? {
                        backgroundImage: "repeating-conic-gradient(#777 0 25%, #bbb 0 50%)",
                        backgroundSize: "8px 8px",
                      }
                    : { background: p.color }
                }
              />
            );
          })}
        </span>
      </span>

      {/* Custom color */}
      <span className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        custom:
        <input
          type="color"
          data-testid="custom-color"
          value={value.bgColor}
          onChange={(e) => {
            setHexDraft(e.target.value);
            update({ ...value, bgMode: "solid", bgColor: e.target.value });
          }}
        />
        <input
          type="text"
          data-testid="custom-hex"
          value={hexDraft}
          onChange={(e) => setHexDraft(e.target.value)}
          onBlur={() => {
            if (HEX_PATTERN.test(hexDraft)) {
              update({ ...value, bgMode: "solid", bgColor: hexDraft });
            } else {
              setHexDraft(value.bgColor);
            }
          }}
          className="w-20 border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-fg-strong)] uppercase"
        />
      </span>

      {/* Output format */}
      <span className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        out:
        <span className="inline-flex border border-[var(--color-hairline)]">
          {(["png", "jpeg"] as const).map((f, i) => (
            <button
              key={f}
              type="button"
              data-testid={`output-${f}`}
              onClick={() => update({ ...value, outputFormat: f })}
              className={`px-2 py-1 uppercase tracking-[0.1em] ${
                value.outputFormat === f
                  ? "bg-[var(--color-fg-strong)] text-[var(--color-bg)]"
                  : "text-[var(--color-fg-muted)]"
              } ${i > 0 ? "border-l border-[var(--color-hairline)]" : ""}`}
            >
              {f}
            </button>
          ))}
        </span>
      </span>

      {/* Quality slider, JPEG only */}
      {showQuality && (
        <span className="flex items-center gap-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
          quality:
          <input
            type="range"
            data-testid="quality-slider"
            min={0.1}
            max={1}
            step={0.05}
            value={value.jpegQuality}
            onChange={(e) => update({ ...value, jpegQuality: Number.parseFloat(e.target.value) })}
            className="w-32"
          />
          <span data-testid="quality-value" className="tabular-nums text-[var(--color-fg-strong)]">
            {value.jpegQuality.toFixed(2)}
          </span>
        </span>
      )}
    </div>
  );
}
