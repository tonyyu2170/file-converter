export function Footer({ count, version }: { count: number; version: string }) {
  return (
    <footer className="flex items-center gap-4 border-t border-[var(--color-hairline)] px-4 py-2 text-[var(--text-xs)] text-[var(--color-fg-muted)]">
      <span>{count} conversions this session</span>
      <span className="text-[var(--color-fg-very-muted)]">
        art:{" "}
        <a
          href="https://nvph-studio.itch.io/dog-animation-4-different-dogs"
          target="_blank"
          rel="noreferrer"
          className="hover:text-[var(--color-fg-strong)]"
        >
          akita by NVPH Studio
        </a>
        {" · "}
        <a
          href="https://creativecommons.org/licenses/by-nd/4.0/"
          target="_blank"
          rel="noreferrer"
          className="hover:text-[var(--color-fg-strong)]"
        >
          CC BY-ND 4.0
        </a>
      </span>
      <span className="ml-auto">{version}</span>
    </footer>
  );
}
