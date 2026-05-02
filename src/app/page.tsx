import Link from "next/link";

const TOOLS = [
  {
    id: "image-convert",
    title: "image convert",
    description: "heic, png, jpg, webp · convert between formats",
    href: "/tools/image-convert",
  },
  {
    id: "image-to-pdf",
    title: "image→pdf",
    description: "combine multiple images into a single pdf",
    href: "/tools/image-to-pdf",
  },
  {
    id: "pdf-merge",
    title: "merge",
    description: "combine multiple pdfs into one",
    href: "/tools/pdf-merge",
  },
  {
    id: "pdf-split",
    title: "split",
    description: "extract page ranges from a pdf",
    href: "/tools/pdf-split",
  },
] as const;

export default function Home() {
  return (
    <main className="p-6">
      <section className="mb-12 max-w-2xl">
        <h1 className="mb-4 text-[var(--text-lg)] uppercase tracking-[0.15em] text-[var(--color-accent)]">
          {"// CONVERT FILES. LOCALLY."}
        </h1>
        <p className="text-[var(--text-sm)] text-[var(--color-fg-muted)] leading-relaxed">
          files never leave your device. every conversion runs in a web worker inside your browser.
          no upload, no server, no telemetry.
        </p>
      </section>

      <div className="mb-3 text-[var(--text-xs)] uppercase tracking-[0.1em] text-[var(--color-fg-very-muted)]">
        {"// tools"}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {TOOLS.map((tool) => (
          <Link
            key={tool.id}
            href={tool.href}
            data-testid={`tool-card-${tool.id}`}
            className="block border border-[var(--color-hairline)] p-5 transition-colors hover:border-[var(--color-accent)]"
          >
            <div className="mb-1 text-[var(--text-base)] text-[var(--color-fg-strong)]">
              {tool.title}
            </div>
            <div className="text-[var(--text-xs)] text-[var(--color-fg-muted)]">
              {tool.description}
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
