"use client";

import { useCallback, useRef, useState } from "react";

type Props = {
  accept?: string[]; // e.g. [".heic", ".heif"]
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  prompt?: string;
  hint?: string;
};

export function DropZone({
  accept,
  multiple = false,
  onFiles,
  prompt = "drop a file",
  hint = "or click to browse",
}: Props) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const arr = Array.from(files);
      onFiles(arr);
    },
    [onFiles],
  );

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept?.join(",")}
        multiple={multiple}
        onChange={(e) => handleFiles(e.target.files)}
        className="sr-only"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          handleFiles(e.dataTransfer?.files ?? null);
        }}
        data-testid="drop-zone"
        data-state={over ? "over" : "idle"}
        className={`flex w-full flex-col items-center justify-center border border-[var(--color-hairline)] bg-[var(--color-surface)] p-12 text-center transition-colors ${
          over ? "border-[var(--color-accent)]" : ""
        }`}
        style={{
          backgroundImage: over
            ? "repeating-linear-gradient(45deg, #0d0d0d 0 6px, #0a0a0a 6px 12px)"
            : undefined,
        }}
      >
        <span className="mb-1 text-[var(--text-base)] text-[var(--color-fg-strong)]">{prompt}</span>
        <span className="text-[var(--text-xs)] text-[var(--color-fg-muted)]">{hint}</span>
      </button>
    </>
  );
}
