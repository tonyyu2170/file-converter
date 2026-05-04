import { PetPanel } from "@/components/pets/pet-panel";
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
  {
    id: "pdf-to-image",
    title: "pdf → image",
    description: "render each page as png or jpeg",
    href: "/tools/pdf-to-image",
  },
  {
    id: "pdf-to-md",
    title: "pdf → md",
    description: "extract markdown from a pdf (heuristic)",
    href: "/tools/pdf-to-md",
  },
  {
    id: "docx-to-pdf",
    title: "docx → pdf",
    description: "render word documents as pdfs",
    href: "/tools/docx-to-pdf",
  },
  {
    id: "image-resize",
    title: "image resize",
    description: "png, jpg, jpeg, webp, heic · resize by px or %",
    href: "/tools/image-resize",
  },
  {
    id: "docx-to-txt",
    title: "docx → txt",
    description: "extract plain text from word documents",
    href: "/tools/docx-to-txt",
  },
  {
    id: "markdown-to-pdf",
    title: "markdown → pdf",
    description: "render markdown as a styled pdf",
    href: "/tools/markdown-to-pdf",
  },
  {
    id: "txt-to-pdf",
    title: "txt → pdf",
    description: "render text verbatim as a monospace pdf",
    href: "/tools/txt-to-pdf",
  },
] as const;

const VERSION = "v0.1.0";

export default function Home() {
  return (
    <main className="relative p-6">
      <PetPanel />
      <div
        className="mb-10 flex items-center gap-3 text-[var(--text-xs)] uppercase tracking-[0.1em]"
        data-testid="status-bar"
      >
        <span className="border border-[var(--color-hairline)] px-2 py-1 text-[var(--color-fg-strong)]">
          {VERSION}
        </span>
        <span className="text-[var(--color-fg-very-muted)]">
          {`// ${TOOLS.length} TOOLS ONLINE`}
        </span>
      </div>

      <h1
        className="mb-8 font-medium text-[40px] leading-[1.0] md:text-[var(--text-display)]"
        data-testid="hero-headline"
      >
        <span className="block text-[var(--color-fg-strong)]">convert files</span>
        <span className="block text-[var(--color-fg-muted)]">without</span>
        <span className="block text-[var(--color-accent)]">uploading</span>
        <span className="block text-[var(--color-fg-strong)]">them.</span>
      </h1>

      <p className="mb-10 max-w-lg text-[var(--text-base)] text-[var(--color-fg-muted)] leading-relaxed">
        files never leave your device. every byte stays in the browser tab — decoded, re-encoded,
        and downloaded by web workers running on your machine. zero servers. zero telemetry.
      </p>

      <div
        className="mb-12 inline-flex items-center gap-3 border border-[var(--color-hairline)] px-4 py-3 text-[var(--text-sm)]"
        data-testid="terminal-prompt"
      >
        <span className="text-[var(--color-accent)]">$</span>
        <span className="text-[var(--color-fg-strong)]">pick a tool below ↓</span>
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
