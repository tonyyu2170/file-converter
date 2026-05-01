type Status = "ready" | "converting" | "done" | "error" | "fatal";

const LABELS: Record<Status, string> = {
  ready: "[ READY ]",
  converting: "[ CONVERTING ]",
  done: "[ DONE ]",
  error: "[ ERROR ]",
  fatal: "[ FATAL ]",
};

const COLORS: Record<Status, string> = {
  ready: "var(--color-fg-muted)",
  converting: "var(--color-accent)",
  done: "var(--color-fg-strong)",
  error: "var(--color-accent)",
  fatal: "var(--color-accent)",
};

export function StatusIndicator({ status }: { status: Status }) {
  return (
    <output aria-live="polite" style={{ color: COLORS[status] }} data-testid="status-indicator">
      {LABELS[status]}
    </output>
  );
}

export type { Status };
