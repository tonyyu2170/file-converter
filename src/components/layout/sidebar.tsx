import Link from "next/link";

type ToolEntry = { id: string; href: string; label: string; group: string };

const TOOLS: ToolEntry[] = [
  { id: "heic-to-png", href: "/tools/heic-to-png", label: "heic→png", group: "IMAGES" },
];

export function Sidebar() {
  const groups = TOOLS.reduce<Record<string, ToolEntry[]>>((acc, t) => {
    const list = acc[t.group] ?? [];
    list.push(t);
    acc[t.group] = list;
    return acc;
  }, {});
  return (
    <nav
      aria-label="Tools"
      className="w-[180px] shrink-0 border-r border-[var(--color-hairline)] px-3 py-3 text-[var(--text-xs)]"
    >
      {Object.entries(groups).map(([group, items]) => (
        <div key={group} className="mb-3">
          <div className="mb-1 text-[var(--color-accent)]">
            {"// "}
            {group}
          </div>
          {items.map((t) => (
            <Link
              key={t.id}
              href={t.href}
              className="block py-0.5 text-[var(--color-fg-muted)] hover:text-[var(--color-fg-strong)]"
            >
              {t.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
