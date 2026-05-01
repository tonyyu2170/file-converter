export function Header() {
  return (
    <header className="flex items-baseline justify-between border-b border-[var(--color-hairline)] px-4 py-3">
      <div className="text-[var(--text-sm)] uppercase tracking-[0.15em] text-[var(--color-accent)]">
        FILE_CONVERTER.LOCAL
      </div>
      <div className="text-[var(--text-xs)] uppercase tracking-[0.1em] text-[var(--color-fg-very-muted)]">
        local · private
      </div>
    </header>
  );
}
