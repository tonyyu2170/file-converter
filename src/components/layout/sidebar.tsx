import Link from "next/link";

type ToolEntry = { id: string; href: string; label: string; group: string };

const TOOLS: ToolEntry[] = [
  { id: "home", href: "/", label: "~/", group: "HOME" },
  { id: "image-convert", href: "/tools/image-convert", label: "image convert", group: "IMAGES" },
  { id: "image-to-pdf", href: "/tools/image-to-pdf", label: "image→pdf", group: "IMAGES" },
  { id: "pdf-merge", href: "/tools/pdf-merge", label: "merge", group: "PDFS" },
  { id: "pdf-split", href: "/tools/pdf-split", label: "split", group: "PDFS" },
  { id: "pdf-to-image", href: "/tools/pdf-to-image", label: "pdf→image", group: "PDFS" },
  { id: "pdf-to-md", href: "/tools/pdf-to-md", label: "pdf→md", group: "PDFS" },
];

const GROUP_ORDER = ["HOME", "IMAGES", "PDFS"] as const;

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
      {GROUP_ORDER.map((group) => {
        const items = groups[group];
        if (!items?.length) return null;
        return (
          <div key={group} className="mb-3">
            <div className="mb-1 text-[var(--color-accent)]">
              {"// "}
              {group}
            </div>
            {items.map((t) => (
              <Link
                key={t.id}
                href={t.href}
                data-testid={t.id === "home" ? "sidebar-home-link" : undefined}
                className="block py-0.5 text-[var(--color-fg-muted)] hover:text-[var(--color-fg-strong)]"
              >
                {t.label}
              </Link>
            ))}
          </div>
        );
      })}
    </nav>
  );
}
