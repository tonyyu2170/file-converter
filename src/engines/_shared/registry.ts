import type { ConversionEngine } from "./types";

export type EngineId = "heic-to-png";
// Future engine ids declared as engines are added in later plans.

type Loader = () => Promise<{ default: ConversionEngine }>;

const REGISTRY: Record<EngineId, Loader> = {
  "heic-to-png": () => import("@/engines/heic-to-png"),
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
