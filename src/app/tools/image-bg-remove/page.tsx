"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine, { disposeBgRemoveHarness } from "@/engines/image-bg-remove";
import { useEffect, useState } from "react";

const BANNER_KEY = "bg-remove-banner-seen";

export default function ImageBgRemovePage() {
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    if (typeof sessionStorage !== "undefined" && !sessionStorage.getItem(BANNER_KEY)) {
      setShowBanner(true);
    }
    return () => disposeBgRemoveHarness();
  }, []);

  function dismiss() {
    sessionStorage.setItem(BANNER_KEY, "1");
    setShowBanner(false);
  }

  return (
    <>
      {showBanner && (
        <div
          data-testid="bg-remove-first-run-banner"
          className="mx-6 mt-3 flex items-center justify-between border border-[var(--color-hairline)] px-3 py-2 text-[var(--text-xs)] uppercase tracking-[0.1em] text-[var(--color-fg-muted)]"
        >
          <span>first conversion downloads ~80 mb. after that it&apos;s instant.</span>
          <button
            type="button"
            onClick={dismiss}
            data-testid="bg-remove-banner-dismiss"
            className="text-[var(--color-accent)] hover:text-[var(--color-fg-strong)]"
          >
            [ dismiss ]
          </button>
        </div>
      )}
      <ToolFrame engine={engine} />
    </>
  );
}
