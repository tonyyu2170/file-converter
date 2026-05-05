"use client";

import type { OptionsPanelProps } from "@/engines/_shared/types";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  type PdfEditOptions,
  type PdfEditPage,
  applyRotateAll,
  deletePage,
  movePage,
  rotatePage,
} from "./options";

const THUMB_SIZE = 120;

type Props = OptionsPanelProps<PdfEditOptions> & {
  /** Map of sourceIndex → object URL for the rendered thumbnail PNG. */
  thumbnails?: Record<number, string>;
  /** Called when a cell scrolls into view; consumer schedules thumbnail render. */
  onRequestThumbnail?: (sourceIndex: number) => void;
};

export function PdfEditOptionsPanel({ value, onChange, thumbnails, onRequestThumbnail }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ids = useMemo(() => value.pages.map((p) => p.id), [value.pages]);

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      const from = ids.indexOf(String(active.id));
      const to = ids.indexOf(String(over.id));
      if (from === -1 || to === -1) return;
      onChange(movePage(value, from, to));
    },
    [ids, onChange, value],
  );

  const handleRotateAll = useCallback(() => {
    onChange(applyRotateAll(value));
  }, [onChange, value]);

  const handleRotateOne = useCallback(
    (id: string) => onChange(rotatePage(value, id)),
    [onChange, value],
  );

  const handleDeleteOne = useCallback(
    (id: string) => onChange(deletePage(value, id)),
    [onChange, value],
  );

  const indicator =
    value.pages.length === value.totalSourcePages
      ? `${value.pages.length} pages`
      : `${value.totalSourcePages} pages → ${value.pages.length} pages`;

  return (
    <div data-testid="pdf-edit-panel" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={handleRotateAll}
          data-testid="rotate-all"
          className="border border-[var(--color-hairline)] px-3 py-1 font-mono text-sm hover:bg-[var(--color-fg)] hover:text-[var(--color-bg)]"
        >
          [ rotate all 90° ]
        </button>
        <span data-testid="page-indicator" className="font-mono text-sm">
          {indicator}
        </span>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={rectSortingStrategy}>
          <div
            data-testid="page-tray"
            className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3"
          >
            {value.pages.map((page, index) => (
              <PageCell
                key={page.id}
                page={page}
                positionIndex={index}
                thumbnailUrl={thumbnails?.[page.sourceIndex]}
                onRequestThumbnail={onRequestThumbnail}
                onRotate={() => handleRotateOne(page.id)}
                onDelete={() => handleDeleteOne(page.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

type PageCellProps = {
  page: PdfEditPage;
  positionIndex: number;
  thumbnailUrl?: string | undefined;
  onRequestThumbnail?: ((sourceIndex: number) => void) | undefined;
  onRotate: () => void;
  onDelete: () => void;
};

function PageCell({
  page,
  positionIndex,
  thumbnailUrl,
  onRequestThumbnail,
  onRotate,
  onDelete,
}: PageCellProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: page.id,
  });
  const cellRef = useRef<HTMLDivElement | null>(null);

  // Combine dnd-kit's setNodeRef with our IntersectionObserver ref
  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      cellRef.current = node;
    },
    [setNodeRef],
  );

  // IntersectionObserver: request thumbnail when cell enters viewport.
  // Stops observing after first request for that page.
  useEffect(() => {
    if (!onRequestThumbnail) return;
    if (thumbnailUrl) return;
    const node = cellRef.current;
    if (!node) return;
    let cancelled = false;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !cancelled) {
            onRequestThumbnail(page.sourceIndex);
            obs.disconnect();
            return;
          }
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(node);
    return () => {
      cancelled = true;
      obs.disconnect();
    };
  }, [onRequestThumbnail, page.sourceIndex, thumbnailUrl]);

  // Chain R/Delete/Backspace handlers with dnd-kit's keyboard listener.
  // Destructure dnd-kit's onKeyDown so we can call it after our own handling
  // (Space and arrow keys must reach dnd-kit's KeyboardSensor).
  const { onKeyDown: dndKeyDown, ...restListeners } = listeners ?? {};

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Only intercept when focus is on the cell itself, not an inner button.
      if (e.target === e.currentTarget) {
        if (e.key === "r" || e.key === "R") {
          e.preventDefault();
          onRotate();
          return;
        }
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          onDelete();
          return;
        }
      }
      // Pass everything else (Space, arrow keys) to dnd-kit's KeyboardSensor.
      dndKeyDown?.(e as unknown as KeyboardEvent);
    },
    [onRotate, onDelete, dndKeyDown],
  );

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setRefs}
      style={style}
      data-testid={`page-cell-${page.sourceIndex}`}
      data-page-id={page.id}
      data-source-index={page.sourceIndex}
      data-rotation={page.rotation}
      aria-label={`page ${page.sourceIndex + 1} — press R to rotate, Delete to remove`}
      className="relative flex flex-col border border-[var(--color-hairline)] bg-[var(--color-bg)] p-2"
      {...attributes}
      {...restListeners}
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-center justify-between text-xs font-mono">
        <span data-testid="page-number">{page.sourceIndex + 1}</span>
        <span data-testid="position-number" className="opacity-50">
          #{positionIndex + 1}
        </span>
      </div>
      <div
        className="my-2 flex aspect-[3/4] w-full items-center justify-center bg-[var(--color-surface)]"
        style={{
          minHeight: THUMB_SIZE,
        }}
      >
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt=""
            data-testid="page-thumbnail"
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              transform: `rotate(${page.rotation}deg)`,
              transition: "transform 120ms ease-out",
            }}
          />
        ) : (
          <span className="font-mono text-xs opacity-50">—</span>
        )}
      </div>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onRotate();
          }}
          data-testid="rotate-btn"
          aria-label={`rotate page ${page.sourceIndex + 1}`}
          className="border border-[var(--color-hairline)] px-2 py-0.5 font-mono text-xs hover:bg-[var(--color-fg)] hover:text-[var(--color-bg)]"
        >
          ↻
        </button>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          data-testid="delete-btn"
          aria-label={`delete page ${page.sourceIndex + 1}`}
          className="border border-[var(--color-hairline)] px-2 py-0.5 font-mono text-xs hover:bg-[var(--color-fg)] hover:text-[var(--color-bg)]"
        >
          ×
        </button>
      </div>
    </div>
  );
}
