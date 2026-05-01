export function Footer({ count, version }: { count: number; version: string }) {
  return (
    <footer className="flex items-center gap-4 border-t border-[var(--color-hairline)] px-4 py-2 text-[var(--text-xs)] text-[var(--color-fg-muted)]">
      <span>{count} conversions this session</span>
      <span className="ml-auto">{version}</span>
    </footer>
  );
}
