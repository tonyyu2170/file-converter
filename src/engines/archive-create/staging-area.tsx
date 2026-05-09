"use client";

import type { StagingAreaProps } from "@/engines/_shared/types";
import { formatBytes } from "@/lib/format-bytes";
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
import { useCallback } from "react";
import type { ArchiveCreateOptions } from "./options";

type RowProps = {
  id: string;
  index: number;
  total: number;
  file: File;
  onMoveUp: (i: number) => void;
  onMoveDown: (i: number) => void;
  onRemove: (i: number) => void;
};

function Row({ id, index, total, file, onMoveUp, onMoveDown, onRemove }: RowProps) {
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
      <span className="flex-1 truncate text-[var(--color-fg)]" title={file.name}>
        {file.name}
      </span>
      <span className="text-[var(--color-fg-muted)] tabular-nums">{formatBytes(file.size)}</span>
      <div className="flex flex-col gap-0.5">
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
      </div>
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

export function ArchiveCreateStagingArea({
  files,
  onChange,
}: StagingAreaProps<ArchiveCreateOptions>) {
  // Key each row by name+size+index. Collisions are harmless for DnD identity
  // within a single session; the index disambiguates duplicate filenames.
  const ids = files.map((f, i) => `${i}__${f.name}__${f.size}`);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = ids.indexOf(String(active.id));
      const newIndex = ids.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return;
      onChange(arrayMove(files, oldIndex, newIndex));
    },
    [ids, files, onChange],
  );

  const onMoveUp = useCallback(
    (i: number) => {
      if (i <= 0) return;
      onChange(arrayMove(files, i, i - 1));
    },
    [files, onChange],
  );

  const onMoveDown = useCallback(
    (i: number) => {
      if (i >= files.length - 1) return;
      onChange(arrayMove(files, i, i + 1));
    },
    [files, onChange],
  );

  const onRemove = useCallback(
    (i: number) => onChange(files.filter((_, idx) => idx !== i)),
    [files, onChange],
  );

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div
          data-testid="archive-create-staging"
          className="mb-3 border border-[var(--color-hairline)] divide-y divide-[var(--color-hairline)]"
        >
          {files.map((f, i) => {
            const id = ids[i];
            if (!id) return null;
            return (
              <Row
                key={id}
                id={id}
                index={i}
                total={files.length}
                file={f}
                onMoveUp={onMoveUp}
                onMoveDown={onMoveDown}
                onRemove={onRemove}
              />
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}
