import type { ConversionEngine, OutputItem } from "./types";

export type EngineId =
  | "docx-to-txt"
  | "image-bg-remove"
  | "image-convert"
  | "image-resize"
  | "image-to-pdf"
  | "markdown-to-pdf"
  | "pdf-merge"
  | "pdf-split"
  | "pdf-to-image"
  | "pdf-to-md"
  | "docx-to-pdf"
  | "txt-to-pdf";

// biome-ignore lint/suspicious/noExplicitAny: registry erases per-engine TOptions
type AnyEngine = ConversionEngine<any, OutputItem | OutputItem[]>;

type Loader = () => Promise<{ default: AnyEngine }>;

const REGISTRY: Record<EngineId, Loader> = {
  "docx-to-txt": () => import("@/engines/docx-to-txt"),
  "image-bg-remove": () => import("@/engines/image-bg-remove"),
  "image-convert": () => import("@/engines/image-convert"),
  "image-resize": () => import("@/engines/image-resize"),
  "image-to-pdf": () => import("@/engines/image-to-pdf"),
  "markdown-to-pdf": () => import("@/engines/markdown-to-pdf"),
  "pdf-merge": () => import("@/engines/pdf-merge"),
  "pdf-split": () => import("@/engines/pdf-split"),
  "pdf-to-image": () => import("@/engines/pdf-to-image"),
  "pdf-to-md": () => import("@/engines/pdf-to-md"),
  "docx-to-pdf": () => import("@/engines/docx-to-pdf"),
  "txt-to-pdf": () => import("@/engines/txt-to-pdf"),
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
