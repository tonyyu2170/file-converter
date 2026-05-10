import type { ConversionEngine, OutputItem } from "./types";

export type EngineId =
  | "archive-create"
  | "archive-extract"
  | "audio-convert"
  | "audio-trim"
  | "data-convert"
  | "docx-to-txt"
  | "image-bg-remove"
  | "image-convert"
  | "image-resize"
  | "image-to-pdf"
  | "image-to-text"
  | "json-format"
  | "markdown-to-pdf"
  | "pdf-edit"
  | "pdf-merge"
  | "pdf-split"
  | "pdf-to-image"
  | "pdf-to-md"
  | "docx-to-pdf"
  | "txt-to-pdf"
  | "video-convert"
  | "video-extract-audio"
  | "video-trim"
  | "xml-to-json";

// biome-ignore lint/suspicious/noExplicitAny: registry erases per-engine TOptions
type AnyEngine = ConversionEngine<any, OutputItem | OutputItem[]>;

type Loader = () => Promise<{ default: AnyEngine }>;

const REGISTRY: Record<EngineId, Loader> = {
  "archive-create": () => import("@/engines/archive-create"),
  "archive-extract": () => import("@/engines/archive-extract"),
  "audio-convert": () => import("@/engines/audio-convert"),
  "audio-trim": () => import("@/engines/audio-trim"),
  "data-convert": () => import("@/engines/data-convert"),
  "docx-to-txt": () => import("@/engines/docx-to-txt"),
  "image-bg-remove": () => import("@/engines/image-bg-remove"),
  "image-convert": () => import("@/engines/image-convert"),
  "image-resize": () => import("@/engines/image-resize"),
  "image-to-pdf": () => import("@/engines/image-to-pdf"),
  "image-to-text": () => import("@/engines/image-to-text"),
  "json-format": () => import("@/engines/json-format"),
  "markdown-to-pdf": () => import("@/engines/markdown-to-pdf"),
  "pdf-edit": () => import("@/engines/pdf-edit"),
  "pdf-merge": () => import("@/engines/pdf-merge"),
  "pdf-split": () => import("@/engines/pdf-split"),
  "pdf-to-image": () => import("@/engines/pdf-to-image"),
  "pdf-to-md": () => import("@/engines/pdf-to-md"),
  "docx-to-pdf": () => import("@/engines/docx-to-pdf"),
  "txt-to-pdf": () => import("@/engines/txt-to-pdf"),
  "video-convert": () => import("@/engines/video-convert"),
  "video-extract-audio": () => import("@/engines/video-extract-audio"),
  "video-trim": () => import("@/engines/video-trim"),
  "xml-to-json": () => import("@/engines/xml-to-json"),
};

export async function loadEngine(id: EngineId): Promise<ConversionEngine> {
  const loader = REGISTRY[id];
  if (!loader) throw new Error(`Unknown engine id: ${id}`);
  const mod = await loader();
  return mod.default;
}

export function listEngineIds(): EngineId[] {
  return Object.keys(REGISTRY) as EngineId[];
}
