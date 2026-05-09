"use client";

import type { OptionsPanelProps } from "@/engines/_shared/types";
import {
  type ArchiveCreateFormat,
  type ArchiveCreateOptions,
  extensionFor,
  validateFilename,
} from "./options";

const FORMATS: ArchiveCreateFormat[] = ["zip", "tar.gz"];

export function ArchiveCreateOptionsPanel({
  value,
  onChange,
}: OptionsPanelProps<ArchiveCreateOptions>) {
  const fnameResult = validateFilename(value.filename);
  const previewName = `${value.filename}.${extensionFor(value.outputFormat)}`;
  return (
    <div
      data-testid="archive-create-options"
      className="mb-3 flex flex-wrap items-center gap-4 border border-[var(--color-hairline)] p-3 text-[var(--text-xs)]"
    >
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
                name="archive-output-format"
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
        filename:
        <input
          type="text"
          data-testid="filename-input"
          value={value.filename}
          onChange={(e) => onChange({ ...value, filename: e.target.value })}
          aria-invalid={!fnameResult.ok}
          className={`border bg-[var(--color-bg)] px-2 py-1 font-mono text-[var(--color-fg)] ${
            fnameResult.ok ? "border-[var(--color-hairline)]" : "border-[var(--color-accent)]"
          }`}
        />
      </label>

      {fnameResult.ok ? (
        <span data-testid="filename-preview" className="text-[var(--color-fg-muted)]">
          → {previewName}
        </span>
      ) : (
        <span data-testid="filename-error" className="text-[var(--color-accent)]">
          {fnameResult.reason}
        </span>
      )}

      <span className="basis-full text-[var(--color-fg-very-muted)]">
        folder structure is flattened — all files become top-level entries.
      </span>
    </div>
  );
}
