"use client";

import { decodeImage } from "@/engines/_shared/decode-image";
import type { StagingAreaProps } from "@/engines/_shared/types";
import { useEffect, useRef, useState } from "react";
import type { ImageToPdfOptions } from "./options";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function makeThumb(file: File): Promise<string> {
  const bitmap = await decodeImage(file);
  try {
    const canvas = new OffscreenCanvas(32, 32);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable");
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, 32, 32);
    const scale = Math.min(32 / bitmap.width, 32 / bitmap.height);
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    const x = (32 - w) / 2;
    const y = (32 - h) / 2;
    ctx.drawImage(bitmap, x, y, w, h);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return URL.createObjectURL(blob);
  } finally {
    bitmap.close();
  }
}

export function ImageToPdfStagingArea({ files, onChange }: StagingAreaProps<ImageToPdfOptions>) {
  const [thumbs, setThumbs] = useState<Map<File, string | "loading" | "error">>(new Map());
  const urlsToRevoke = useRef<string[]>([]);
  const startedFiles = useRef<Set<File>>(new Set());

  useEffect(() => {
    const newFiles = files.filter((f) => !startedFiles.current.has(f));
    if (newFiles.length === 0) return;
    for (const f of newFiles) startedFiles.current.add(f);

    setThumbs((prev) => {
      const next = new Map(prev);
      for (const f of newFiles) next.set(f, "loading");
      return next;
    });

    Promise.all(
      newFiles.map(async (f) => {
        try {
          const url = await makeThumb(f);
          return { file: f, url };
        } catch {
          return { file: f, url: "error" as const };
        }
      }),
    ).then((results) => {
      // Gate on the "loading" sentinel: if the file was removed during
      // decode (cleanup effect cleared its Map entry), prev.get returns
      // undefined and we skip the commit. The orphan URL is tracked in
      // urlsToRevoke so it gets cleaned up on unmount.
      setThumbs((prev) => {
        const next = new Map(prev);
        for (const r of results) {
          if (prev.get(r.file) === "loading") next.set(r.file, r.url);
        }
        return next;
      });
      for (const r of results) {
        if (r.url !== "error") urlsToRevoke.current.push(r.url);
      }
    });
  }, [files]);

  useEffect(() => {
    return () => {
      for (const url of urlsToRevoke.current) URL.revokeObjectURL(url);
      urlsToRevoke.current = [];
    };
  }, []);

  useEffect(() => {
    // Compute removed files synchronously from current state before
    // queueing the setThumbs updater. Side effects (URL revoke, ref
    // delete) happen here so they don't run twice under Strict Mode's
    // double-invoked updaters.
    const filesSet = new Set(files);
    const removed: Array<[File, string | "loading" | "error"]> = [];
    for (const f of startedFiles.current) {
      if (!filesSet.has(f)) {
        removed.push([f, thumbs.get(f) ?? "loading"]);
        startedFiles.current.delete(f);
      }
    }
    for (const [, v] of removed) {
      if (typeof v === "string" && v !== "error" && v !== "loading") {
        URL.revokeObjectURL(v);
      }
    }
    if (removed.length === 0) return;
    setThumbs((prev) => {
      const next = new Map<File, string | "loading" | "error">();
      for (const f of files) {
        const v = prev.get(f);
        if (v !== undefined) next.set(f, v);
      }
      return next;
    });
  }, [files, thumbs]);

  function moveUp(i: number) {
    if (i <= 0) return;
    const next = [...files];
    const tmp = next[i - 1]!;
    next[i - 1] = next[i]!;
    next[i] = tmp;
    onChange(next);
  }

  function moveDown(i: number) {
    if (i >= files.length - 1) return;
    const next = [...files];
    const tmp = next[i + 1]!;
    next[i + 1] = next[i]!;
    next[i] = tmp;
    onChange(next);
  }

  function remove(i: number) {
    onChange(files.filter((_, idx) => idx !== i));
  }

  return (
    <div
      data-testid="image-to-pdf-staging"
      className="mb-3 border border-[var(--color-hairline)] divide-y divide-[var(--color-hairline)]"
    >
      {files.map((f, i) => {
        const thumb = thumbs.get(f);
        return (
          <div
            key={`${f.name}-${i}`}
            data-testid="staging-row"
            className="flex items-center gap-3 px-3 py-2 text-[var(--text-xs)]"
          >
            <span className="w-6 text-right text-[var(--color-accent)] tabular-nums">{i + 1}</span>
            <div className="h-8 w-8 flex-shrink-0 border border-[var(--color-hairline)] bg-[var(--color-bg)]">
              {thumb && thumb !== "loading" && thumb !== "error" && (
                <img src={thumb} alt="" className="h-full w-full object-contain" />
              )}
              {thumb === "error" && (
                <span className="flex h-full w-full items-center justify-center text-[var(--color-fg-very-muted)]">
                  ?
                </span>
              )}
            </div>
            <span className="flex-1 truncate text-[var(--color-fg)]" title={f.name}>
              {f.name}
            </span>
            <span className="text-[var(--color-fg-muted)] tabular-nums">{formatSize(f.size)}</span>
            <button
              type="button"
              data-testid="move-up"
              onClick={() => moveUp(i)}
              disabled={i === 0}
              className="border border-[var(--color-hairline)] px-2 py-0.5 text-[var(--color-fg-muted)] disabled:opacity-30"
            >
              ↑
            </button>
            <button
              type="button"
              data-testid="move-down"
              onClick={() => moveDown(i)}
              disabled={i === files.length - 1}
              className="border border-[var(--color-hairline)] px-2 py-0.5 text-[var(--color-fg-muted)] disabled:opacity-30"
            >
              ↓
            </button>
            <button
              type="button"
              data-testid="remove"
              onClick={() => remove(i)}
              className="border border-[var(--color-hairline)] px-2 py-0.5 text-[var(--color-fg-muted)]"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
