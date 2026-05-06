"use client";

import { listEngineIds, loadEngine } from "@/engines/_shared/registry";
import { useEffect, useState } from "react";

type Row = {
  id: string;
  category: string;
  library: string;
  license: string;
};

export function EnginesTable() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ids = listEngineIds();
      const loaded = await Promise.all(
        ids.map(async (id) => {
          const e = await loadEngine(id);
          return {
            id: e.id,
            category: e.category,
            library: e.library ?? "—",
            license: e.license ?? "—",
          };
        }),
      );
      loaded.sort((a, b) =>
        a.category === b.category ? a.id.localeCompare(b.id) : a.category.localeCompare(b.category),
      );
      if (!cancelled) setRows(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!rows) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-fg-very-muted)]">— loading engines —</p>
    );
  }

  return (
    <table
      data-testid="engines-table"
      className="w-full border-collapse text-[var(--text-xs)] text-[var(--color-fg-muted)]"
    >
      <thead>
        <tr className="border-b border-[var(--color-hairline)] text-left">
          <th className="py-1 pr-4 font-medium text-[var(--color-fg-strong)]">tool</th>
          <th className="py-1 pr-4 font-medium text-[var(--color-fg-strong)]">library</th>
          <th className="py-1 font-medium text-[var(--color-fg-strong)]">license</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.id}
            data-testid={`engine-row-${r.id}`}
            className="border-b border-[var(--color-hairline)]/50"
          >
            <td className="py-1 pr-4 text-[var(--color-fg)]">{r.id}</td>
            <td className="py-1 pr-4">{r.library}</td>
            <td className="py-1">{r.license}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
