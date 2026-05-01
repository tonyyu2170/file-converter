"use client";

import { DropZone } from "@/components/drop-zone";
import { detectMime } from "@/engines/_shared/file-detection";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function Home() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: File[]) {
    setError(null);
    const f = files[0];
    if (!f) return;
    const mime = await detectMime(f);
    if (mime === "image/heic" || mime === "image/heif") {
      router.push("/tools/heic-to-png");
      return;
    }
    setError("No tool for this file type yet. Phase 1 ships HEIC only.");
  }

  return (
    <main className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        <DropZone
          onFiles={handleFiles}
          prompt="drop a file"
          hint="HEIC supported. More tools shipping in subsequent phases."
        />
        {error && (
          <output
            aria-live="polite"
            className="mt-3 block border border-[var(--color-accent)] p-3 text-[var(--text-sm)] text-[var(--color-fg-strong)]"
          >
            {error}
          </output>
        )}
      </div>
    </main>
  );
}
