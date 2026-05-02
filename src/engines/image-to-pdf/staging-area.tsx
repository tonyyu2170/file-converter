"use client";

import { decodeImage } from "@/engines/_shared/decode-image";
import type { StagingAreaProps } from "@/engines/_shared/types";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ImageToPdfOptions } from "./options";

function newRowId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `row-${Math.random().toString(36).slice(2)}`;
}

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

type SortableRowProps = {
  id: string;
  file: File;
  index: number;
  total: number;
  thumb: string | "loading" | "error" | undefined;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  onRemove: (index: number) => void;
};

function SortableRow({
  id,
  file,
  index,
  total,
  thumb,
  onMoveUp,
  onMoveDown,
  onRemove,
}: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid="staging-row"
      className="flex items-center gap-3 px-3 py-2 text-[var(--text-xs)]"
    >
      <button
        type="button"
        data-testid="drag-handle"
        aria-label={`Drag to reorder ${file.name}`}
        {...attributes}
        {...listeners}
        className="cursor-grab text-[var(--color-fg-very-muted)] hover:text-[var(--color-fg-strong)]"
      >
        ≡
      </button>
      <span className="w-6 text-right text-[var(--color-accent)] tabular-nums">{index + 1}</span>
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
      <span className="flex-1 truncate text-[var(--color-fg)]" title={file.name}>
        {file.name}
      </span>
      <span className="text-[var(--color-fg-muted)] tabular-nums">{formatSize(file.size)}</span>
      <button
        type="button"
        data-testid="move-up"
        onClick={() => onMoveUp(index)}
        disabled={index === 0}
        className="border border-[var(--color-hairline)] px-2 py-0.5 text-[var(--color-fg-muted)] disabled:opacity-30"
      >
        ↑
      </button>
      <button
        type="button"
        data-testid="move-down"
        onClick={() => onMoveDown(index)}
        disabled={index === total - 1}
        className="border border-[var(--color-hairline)] px-2 py-0.5 text-[var(--color-fg-muted)] disabled:opacity-30"
      >
        ↓
      </button>
      <button
        type="button"
        data-testid="remove"
        onClick={() => onRemove(index)}
        className="border border-[var(--color-hairline)] px-2 py-0.5 text-[var(--color-fg-muted)]"
      >
        ×
      </button>
    </div>
  );
}

export function ImageToPdfStagingArea({ files, onChange }: StagingAreaProps<ImageToPdfOptions>) {
  const [thumbs, setThumbs] = useState<Map<File, string | "loading" | "error">>(new Map());
  const urlsToRevoke = useRef<string[]>([]);
  const startedFiles = useRef<Set<File>>(new Set());
  // Stable id per File for dnd-kit. Allocated on first encounter; persisted across reorders.
  const fileIds = useRef<Map<File, string>>(new Map());
  for (const f of files) {
    if (!fileIds.current.has(f)) fileIds.current.set(f, newRowId());
  }

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
    const filesSet = new Set(files);
    const removed: Array<[File, string | "loading" | "error"]> = [];
    for (const f of startedFiles.current) {
      if (!filesSet.has(f)) {
        removed.push([f, thumbs.get(f) ?? "loading"]);
        startedFiles.current.delete(f);
        fileIds.current.delete(f);
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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = files.findIndex((f) => fileIds.current.get(f) === active.id);
      const newIndex = files.findIndex((f) => fileIds.current.get(f) === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      onChange(arrayMove(files, oldIndex, newIndex));
    },
    [files, onChange],
  );

  const moveUp = useCallback(
    (i: number) => {
      if (i <= 0) return;
      onChange(arrayMove(files, i, i - 1));
    },
    [files, onChange],
  );
  const moveDown = useCallback(
    (i: number) => {
      if (i >= files.length - 1) return;
      onChange(arrayMove(files, i, i + 1));
    },
    [files, onChange],
  );
  const remove = useCallback(
    (i: number) => {
      onChange(files.filter((_, idx) => idx !== i));
    },
    [files, onChange],
  );

  const items = files.map((f) => fileIds.current.get(f) ?? "");

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <div
          data-testid="image-to-pdf-staging"
          className="mb-3 border border-[var(--color-hairline)] divide-y divide-[var(--color-hairline)]"
        >
          {files.map((f, i) => {
            const id = fileIds.current.get(f) ?? `row-${i}`;
            const thumb = thumbs.get(f);
            return (
              <SortableRow
                key={id}
                id={id}
                file={f}
                index={i}
                total={files.length}
                thumb={thumb}
                onMoveUp={moveUp}
                onMoveDown={moveDown}
                onRemove={remove}
              />
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}
