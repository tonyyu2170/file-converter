import type { ConversionEngine, OutputItem } from "./types";

export type EngineId = "image-convert" | "image-to-pdf" | "pdf-merge" | "pdf-split";

// biome-ignore lint/suspicious/noExplicitAny: registry erases per-engine TOptions
type AnyEngine = ConversionEngine<any, OutputItem | OutputItem[]>;

type Loader = () => Promise<{ default: AnyEngine }>;

const REGISTRY: Record<EngineId, Loader> = {
  "image-convert": () => import("@/engines/image-convert"),
  "image-to-pdf": () => import("@/engines/image-to-pdf"),
  "pdf-merge": () => import("@/engines/pdf-merge"),
  "pdf-split": () => import("@/engines/pdf-split"),
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
