// src/engines/json-format/options-panel.tsx
"use client";

import type { OptionsPanelProps } from "@/engines/_shared/types";
import type { JsonFormatIndent, JsonFormatMode, JsonFormatOptions } from "./options";

const MODES: JsonFormatMode[] = ["pretty", "minify"];
const INDENTS: JsonFormatIndent[] = [2, 4, "tab"];

export function JsonFormatOptionsPanel({ value, onChange }: OptionsPanelProps<JsonFormatOptions>) {
  return (
    <div
      data-testid="json-format-options"
      className="mb-3 flex flex-wrap items-center gap-4 border border-[var(--color-hairline)] p-3 text-[var(--text-xs)]"
    >
      <fieldset className="flex items-center gap-2 border-0 p-0 m-0">
        <legend className="float-left mr-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
          mode:
        </legend>
        <span className="inline-flex gap-3">
          {MODES.map((m) => (
            <label
              key={m}
              className="flex cursor-pointer items-center gap-1 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]"
            >
              <input
                type="radio"
                name="json-format-mode"
                value={m}
                checked={value.mode === m}
                onChange={() => onChange({ ...value, mode: m })}
                className="accent-[var(--color-fg-strong)]"
              />
              {m}
            </label>
          ))}
        </span>
      </fieldset>

      {value.mode === "pretty" && (
        <fieldset className="flex items-center gap-2 border-0 p-0 m-0">
          <legend className="float-left mr-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
            indent:
          </legend>
          <span className="inline-flex gap-3">
            {INDENTS.map((i) => (
              <label
                key={String(i)}
                className="flex cursor-pointer items-center gap-1 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]"
              >
                <input
                  type="radio"
                  name="json-format-indent"
                  value={String(i)}
                  checked={value.indent === i}
                  onChange={() => onChange({ ...value, indent: i })}
                  className="accent-[var(--color-fg-strong)]"
                />
                {String(i)}
              </label>
            ))}
          </span>
        </fieldset>
      )}
    </div>
  );
}
