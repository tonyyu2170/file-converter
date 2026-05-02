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
    const IMAGE_MIMES = new Set([
      "image/heic",
      "image/heif",
      "image/png",
      "image/jpeg",
      "image/webp",
    ]);
    const allImages = mimes.every((m) => IMAGE_MIMES.has(m));
    const allPdfs = mimes.every((m) => m === "application/pdf");

    if (allImages) {
      if (files.length >= 2) {
        stageFiles(files);
        router.push("/tools/image-to-pdf");
        return;
      }
      stageFiles(files);
      router.push("/tools/image-convert");
      return;
    }

    if (allPdfs) {
      if (files.length >= 2) {
        stageFiles(files);
        router.push("/tools/pdf-merge");
        return;
      }
      setError("Need 2+ PDFs to merge.");
      return;
    }

    setError(
      "All files must be the same type. Phase 4 supports HEIC/PNG/JPEG/WebP for images and PDF for merging.",
    );
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
