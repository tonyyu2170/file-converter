type Status = "ready" | "converting" | "done" | "error" | "fatal";

const LABELS: Record<Status, string> = {
  ready: "[ READY ]",
  converting: "[ CONVERTING ]",
  done: "[ DONE ]",
  error: "[ ERROR ]",
  fatal: "[ FATAL ]",
};

// Per-status color via Tailwind utility classes (compiled at build time)
// instead of an inline style attribute. Inline styles violate the production
// CSP `style-src 'self'` directive and were the source of the v2 Lighthouse
// Best Practices regression to 92 on every /tools/* route.
const COLOR_CLASSES: Record<Status, string> = {
  ready: "text-[var(--color-fg-muted)]",
  converting: "text-[var(--color-accent)]",
  done: "text-[var(--color-fg-strong)]",
  error: "text-[var(--color-accent)]",
  fatal: "text-[var(--color-accent)]",
};

export function StatusIndicator({ status }: { status: Status }) {
  return (
    <output aria-live="polite" className={COLOR_CLASSES[status]} data-testid="status-indicator">
      {LABELS[status]}
    </output>
  );
}

export type { Status };
