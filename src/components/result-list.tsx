"use client";

import type { OutputItem } from "@/engines/_shared/types";
import { download } from "@/lib/download";

type Props = {
  items: OutputItem[];
};

export function ResultList({ items }: Props) {
  if (items.length === 0) return null;
  return (
    <ul
      aria-label="Conversion results"
      className="mt-4 divide-y divide-[var(--color-hairline)] border border-[var(--color-hairline)]"
    >
      {items.map((item) => (
        <li
          key={item.filename}
          className="flex items-center justify-between px-3 py-2 text-[var(--text-sm)]"
        >
          <span className="truncate text-[var(--color-fg)]">{item.filename}</span>
          <button
            type="button"
            onClick={() => download(item.blob, item.filename)}
            className="border border-[var(--color-hairline)] px-2 py-1 text-[var(--text-xs)] uppercase tracking-[0.1em] text-[var(--color-fg-strong)] hover:border-[var(--color-accent)]"
          >
            download
          </button>
        </li>
      ))}
    </ul>
  );
}
