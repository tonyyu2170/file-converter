import { type Status, StatusIndicator } from "@/components/status-indicator";

export function Footer({
  status,
  count,
  version,
}: { status: Status; count: number; version: string }) {
  return (
    <footer className="flex items-center gap-4 border-t border-[var(--color-hairline)] px-4 py-2 text-[var(--text-xs)] text-[var(--color-fg-muted)]">
      <span>STATUS:</span>
      <StatusIndicator status={status} />
      <span aria-hidden="true">·</span>
      <span>{count} conversions this session</span>
      <span className="ml-auto">{version}</span>
    </footer>
  );
}
