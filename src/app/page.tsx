"use client";

import { DropZone } from "@/components/drop-zone";
import { detectMime } from "@/engines/_shared/file-detection";
import { stageFiles } from "@/lib/handoff";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function Home() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: File[]) {
    setError(null);
    if (files.length === 0) return;

    const mimes = await Promise.all(files.map(detectMime));
    const SUPPORTED = new Set([
      "image/heic",
      "image/heif",
      "image/png",
      "image/jpeg",
      "image/webp",
    ]);
    const allImages = mimes.every((m) => SUPPORTED.has(m));

    if (!allImages) {
      setError("No tool for this file type yet. Phase 3 supports HEIC, PNG, JPEG, WebP.");
      return;
    }

    if (files.length >= 2) {
      stageFiles(files);
      router.push("/tools/image-to-pdf");
      return;
    }

    // Single file: HEIC + PNG/JPEG/WebP all → image-convert (post-consolidation)
    stageFiles(files);
    router.push("/tools/image-convert");
  }

  return (
    <main className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        <DropZone
          multiple
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
