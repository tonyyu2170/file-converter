import { PetPanel } from "@/components/pets/pet-panel";
import Link from "next/link";

type Category = "image" | "pdf" | "document" | "audio" | "video" | "archive" | "data" | "ocr";

const TOOLS = [
  {
    id: "image-convert",
    title: "image convert",
    description: "heic, png, jpg, webp · convert between formats",
    href: "/tools/image-convert",
    category: "image",
  },
  {
    id: "image-to-pdf",
    title: "image→pdf",
    description: "combine multiple images into a single pdf",
    href: "/tools/image-to-pdf",
    category: "image",
  },
  {
    id: "pdf-merge",
    title: "merge",
    description: "combine multiple pdfs into one",
    href: "/tools/pdf-merge",
    category: "pdf",
  },
  {
    id: "pdf-edit",
    title: "edit",
    description: "rotate, reorder, delete pages of a pdf",
    href: "/tools/pdf-edit",
    category: "pdf",
  },
  {
    id: "pdf-split",
    title: "split",
    description: "extract page ranges from a pdf",
    href: "/tools/pdf-split",
    category: "pdf",
  },
  {
    id: "pdf-to-image",
    title: "pdf → image",
    description: "render each page as png or jpeg",
    href: "/tools/pdf-to-image",
    category: "pdf",
  },
  {
    id: "pdf-to-md",
    title: "pdf → md",
    description: "extract markdown from a pdf (heuristic)",
    href: "/tools/pdf-to-md",
    category: "pdf",
  },
  {
    id: "docx-to-pdf",
    title: "docx → pdf",
    description: "render word documents as pdfs",
    href: "/tools/docx-to-pdf",
    category: "document",
  },
  {
    id: "image-resize",
    title: "image resize",
    description: "png, jpg, jpeg, webp, heic · resize by px or %",
    href: "/tools/image-resize",
    category: "image",
  },
  {
    id: "image-bg-remove",
    title: "image bg remove",
    description: "png, jpg, webp · cutout to transparent or solid color",
    href: "/tools/image-bg-remove",
    category: "image",
  },
  {
    id: "docx-to-txt",
    title: "docx → txt",
    description: "extract plain text from word documents",
    href: "/tools/docx-to-txt",
    category: "document",
  },
  {
    id: "markdown-to-pdf",
    title: "markdown → pdf",
    description: "render markdown as a styled pdf",
    href: "/tools/markdown-to-pdf",
    category: "document",
  },
  {
    id: "txt-to-pdf",
    title: "txt → pdf",
    description: "render text verbatim as a monospace pdf",
    href: "/tools/txt-to-pdf",
    category: "document",
  },
  {
    id: "audio-convert",
    title: "audio convert",
    description: "mp3, wav, m4a, flac · convert between formats",
    href: "/tools/audio-convert",
    category: "audio",
  },
  {
    id: "audio-trim",
    title: "audio trim",
    description: "mp3, wav, m4a, flac · trim to a sub-range, lossless when format unchanged",
    href: "/tools/audio-trim",
    category: "audio",
  },
  {
    id: "video-convert",
    title: "video convert",
    description: "mp4, mov, webm, mkv · transcode between formats with quality control",
    href: "/tools/video-convert",
    category: "video",
  },
  {
    id: "video-trim",
    title: "video trim",
    description: "mp4, mov, webm, mkv · trim to a sub-range, lossless via -c copy",
    href: "/tools/video-trim",
    category: "video",
  },
  {
    id: "video-extract-audio",
    title: "video → audio",
    description: "mp4, mov, webm, mkv · pull the audio track, lossless when possible",
    href: "/tools/video-extract-audio",
    category: "video",
  },
  {
    id: "image-to-text",
    title: "image → text",
    description: "jpg, png, webp, heic · extract text via ocr (tesseract)",
    href: "/tools/image-to-text",
    category: "ocr",
  },
  {
    id: "archive-extract",
    title: "archive extract",
    description: "zip, tar, tar.gz · extract entries; safe paths only",
    href: "/tools/archive-extract",
    category: "archive",
  },
  {
    id: "archive-create",
    title: "archive create",
    description: "any files in · zip or tar.gz out · custom filename",
    href: "/tools/archive-create",
    category: "archive",
  },
  {
    id: "data-convert",
    title: "data convert",
    description: "csv, json, yaml · convert between formats",
    href: "/tools/data-convert",
    category: "data",
  },
  {
    id: "json-format",
    title: "json format",
    description: "json · pretty-print or minify with indent control",
    href: "/tools/json-format",
    category: "data",
  },
  {
    id: "xml-to-json",
    title: "xml → json",
    description: "xml · convert to json (one-way)",
    href: "/tools/xml-to-json",
    category: "data",
  },
] as const satisfies ReadonlyArray<{
  id: string;
  title: string;
  description: string;
  href: string;
  category: Category;
}>;

const SECTION_ORDER: ReadonlyArray<{ category: Category; label: string }> = [
  { category: "image", label: "images" },
  { category: "pdf", label: "pdfs" },
  { category: "document", label: "docs" },
  { category: "audio", label: "audio" },
  { category: "video", label: "video" },
  { category: "archive", label: "archives" },
  { category: "data", label: "data" },
  { category: "ocr", label: "ocr" },
];

const VERSION = "v2.0.0";

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

      <div className="space-y-10">
        {SECTION_ORDER.map(({ category, label }) => {
          const items = TOOLS.filter((t) => t.category === category);
          if (items.length === 0) return null;
          return (
            <section key={category} data-testid={`home-section-${category}`}>
              <h2 className="mb-3 text-[var(--text-xs)] uppercase tracking-[0.1em] text-[var(--color-accent)]">
                [ {label} ]
              </h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {items.map((tool) => (
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
            </section>
          );
        })}
      </div>
    </main>
  );
}
