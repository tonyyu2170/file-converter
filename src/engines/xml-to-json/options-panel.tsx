// src/engines/xml-to-json/options-panel.tsx
"use client";

import type { OptionsPanelProps } from "@/engines/_shared/types";
import type { XmlToJsonAttributePrefix, XmlToJsonOptions } from "./options";

const PREFIXES: Array<{ value: XmlToJsonAttributePrefix; label: string }> = [
  { value: "@", label: "@ (default)" },
  { value: "$_", label: "$_" },
  { value: "", label: "(none — collisions possible)" },
];

export function XmlToJsonOptionsPanel({ value, onChange }: OptionsPanelProps<XmlToJsonOptions>) {
  return (
    <div
      data-testid="xml-to-json-options"
      className="mb-3 flex flex-wrap items-center gap-4 border border-[var(--color-hairline)] p-3 text-[var(--text-xs)]"
    >
      <fieldset className="flex items-center gap-2 border-0 p-0 m-0">
        <legend className="float-left mr-2 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
          attribute prefix:
        </legend>
        <span className="inline-flex flex-wrap gap-3">
          {PREFIXES.map((p) => (
            <label
              key={p.label}
              className="flex cursor-pointer items-center gap-1 uppercase tracking-[0.1em] text-[var(--color-fg-muted)]"
            >
              <input
                type="radio"
                name="xml-to-json-attribute-prefix"
                value={p.value}
                checked={value.attributePrefix === p.value}
                onChange={() => onChange({ ...value, attributePrefix: p.value })}
                className="accent-[var(--color-fg-strong)]"
              />
              {p.label}
            </label>
          ))}
        </span>
      </fieldset>
    </div>
  );
}
