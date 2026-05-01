import type { ConversionEngine } from "./types";

export type EngineId = "heic-to-png";
// Future engine ids declared as engines are added in later plans.

type Loader = () => Promise<{ default: ConversionEngine }>;

// The "@/engines/heic-to-png" module is created in Task 9.  Until then the
// loader throws a descriptive error at call time rather than import time, so
// tests that only exercise the negative path (unknown id) and listEngineIds
// continue to pass.  Task 9 replaces this with the real dynamic import.
const heicToPngLoader: Loader = () => {
  throw new Error("heic-to-png engine not yet implemented (arriving in Task 9)");
};

const REGISTRY: Record<EngineId, Loader> = {
  "heic-to-png": heicToPngLoader,
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
