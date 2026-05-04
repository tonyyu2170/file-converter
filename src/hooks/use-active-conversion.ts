import { useEffect } from "react";

let activeCount = 0;
let listenerInstalled = false;

function handler(e: BeforeUnloadEvent) {
  e.preventDefault();
  // Required by older Chromium versions even though the spec deprecates it.
  e.returnValue = "";
}

function ensureListener() {
  if (activeCount > 0 && !listenerInstalled) {
    window.addEventListener("beforeunload", handler);
    listenerInstalled = true;
  } else if (activeCount === 0 && listenerInstalled) {
    window.removeEventListener("beforeunload", handler);
    listenerInstalled = false;
  }
}

/**
 * While `active` is true, this hook contributes to a tab-local counter
 * that installs a `beforeunload` listener whenever any consumer is
 * active. The browser shows its native "leave site?" prompt while at
 * least one consumer is active.
 *
 * Designed for the conversion in-flight case (PRD §11.4). Forward-
 * compatible with future concurrency: if multiple ToolFrames or batch
 * runners are simultaneously active, the listener stays attached until
 * all consumers finish.
 */
export function useActiveConversion(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    activeCount++;
    ensureListener();
    return () => {
      activeCount--;
      ensureListener();
    };
  }, [active]);
}

/** Test-only: reset module state between tests. */
export function __resetForTests(): void {
  if (listenerInstalled) {
    window.removeEventListener("beforeunload", handler);
  }
  activeCount = 0;
  listenerInstalled = false;
}
