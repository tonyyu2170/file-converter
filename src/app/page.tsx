"use client";

import { DropZone } from "@/components/drop-zone";
import { detectMime } from "@/engines/_shared/file-detection";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  async function handleFiles(files: File[]) {
    const f = files[0];
    if (!f) return;
    const mime = await detectMime(f);
    if (mime === "image/heic" || mime === "image/heif") {
      router.push("/tools/heic-to-png");
      return;
    }
    alert(`No engine yet for ${mime} (Phase 1 ships HEIC only).`);
  }

  return (
    <main className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        <DropZone
          onFiles={handleFiles}
          prompt="drop a file"
          hint="HEIC supported. More tools shipping in subsequent phases."
        />
      </div>
    </main>
  );
}
