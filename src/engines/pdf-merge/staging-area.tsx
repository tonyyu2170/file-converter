"use client";

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
import type { PdfMergeOptions, PdfMergeRow } from "./options";
import { parseRange } from "./range";
import { renderFirstPageThumbnail } from "./render-thumbnail";

type RowMeta = {
  thumbnailUrl: string | undefined;
};

function newRowId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `row-${Math.random().toString(36).slice(2)}`;
}

function formatPages(row: PdfMergeRow): string {
  if (row.encrypted) return "[ password-protected ]";
  if (row.pageCount === undefined) return "loading...";
  return row.pageCount === 1 ? "1 page" : `${row.pageCount} pages`;
}

type SortableRowProps = {
  row: PdfMergeRow;
  index: number;
  total: number;
  thumb: RowMeta;
  onRangeChange: (id: string, value: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onRemove: (id: string) => void;
};

function SortableRow({
  row,
  index,
  total,
  thumb,
  onRangeChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
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
        aria-label={`Drag to reorder ${row.fileName}`}
        {...attributes}
        {...listeners}
        className="cursor-grab text-[var(--color-fg-very-muted)] hover:text-[var(--color-fg-strong)]"
      >
        ≡
      </button>
      <span className="w-6 text-right text-[var(--color-accent)] tabular-nums">{index + 1}</span>
      <div className="h-8 w-8 flex-shrink-0 border border-[var(--color-hairline)] bg-[var(--color-bg)]">
        {thumb.thumbnailUrl ? (
          <img src={thumb.thumbnailUrl} alt="" className="h-full w-full object-contain" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[var(--color-fg-very-muted)]">
            ?
          </span>
        )}
      </div>
      <span className="flex-1 truncate text-[var(--color-fg)]" title={row.fileName}>
        {row.fileName}
      </span>
      <span
        className={
          row.encrypted
            ? "text-[var(--color-accent)] tabular-nums"
            : "text-[var(--color-fg-muted)] tabular-nums"
        }
      >
        {formatPages(row)}
      </span>
      <div className="flex flex-col gap-0.5">
        <input
          type="text"
          data-testid="range-input"
          value={row.rangeInput}
          placeholder="all"
          disabled={row.encrypted || row.pageCount === undefined}
          onChange={(e) => onRangeChange(row.id, e.target.value)}
          className="w-24 border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2 py-0.5 font-mono text-[var(--color-fg)]"
        />
        {row.rangeError && (
          <span data-testid="range-error" className="text-[var(--color-accent)]">
            {row.rangeError}
          </span>
        )}
      </div>
      <button
        type="button"
        data-testid="move-up"
        onClick={() => onMoveUp(row.id)}
        disabled={index === 0}
        className="border border-[var(--color-hairline)] px-2 py-0.5 text-[var(--color-fg-muted)] disabled:opacity-30"
      >
        ↑
      </button>
      <button
        type="button"
        data-testid="move-down"
        onClick={() => onMoveDown(row.id)}
        disabled={index === total - 1}
        className="border border-[var(--color-hairline)] px-2 py-0.5 text-[var(--color-fg-muted)] disabled:opacity-30"
      >
        ↓
      </button>
      <button
        type="button"
        data-testid="remove"
        onClick={() => onRemove(row.id)}
        className="border border-[var(--color-hairline)] px-2 py-0.5 text-[var(--color-fg-muted)]"
      >
        ×
      </button>
    </div>
  );
}

export function PdfMergeStagingArea({
  files,
  onChange,
  options,
  setOptions,
}: StagingAreaProps<PdfMergeOptions>) {
  // Local thumbnail map keyed by row id (object URLs aren't part of options).
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const urlsToRevoke = useRef<string[]>([]);
  // file → row.id; allocated on add, used to look up the row that owns a File.
  const fileToId = useRef<Map<File, string>>(new Map());
  // The latest options.rows seen, kept in sync via a ref so async load callbacks
  // can read up-to-date row state without stale closures.
  const latestRowsRef = useRef<PdfMergeRow[]>(options.rows);
  useEffect(() => {
    latestRowsRef.current = options.rows;
  }, [options.rows]);

  // When new files appear in props (drop or external add), allocate row state
  // and kick off async metadata + thumbnail loads.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — keyed on files only
  useEffect(() => {
    const newFiles = files.filter((f) => !fileToId.current.has(f));
    if (newFiles.length === 0 && options.rows.length === files.length) return;

    if (newFiles.length > 0) {
      const newRows: PdfMergeRow[] = newFiles.map((f) => {
        const id = newRowId();
        fileToId.current.set(f, id);
        return {
          id,
          fileName: f.name,
          pageCount: undefined,
          encrypted: false,
          rangeInput: "",
          parsedRange: [],
          rangeError: undefined,
        };
      });
      const updated = [...options.rows, ...newRows];
      latestRowsRef.current = updated;
      setOptions({ rows: updated });

      for (const f of newFiles) {
        const id = fileToId.current.get(f);
        if (!id) continue;
        void loadMetadata(f, id);
        void loadThumbnail(f, id);
      }
    }

    async function loadMetadata(file: File, rowId: string) {
      try {
        const bytes = await file.arrayBuffer();
        const { PDFDocument } = await import("pdf-lib");
        try {
          const doc = await PDFDocument.load(bytes);
          commitMetadata(rowId, { pageCount: doc.getPageCount(), encrypted: false });
        } catch (err: unknown) {
          // pdf-lib's EncryptedPDFError doesn't round-trip reliably as
          // instanceof / constructor.name across lazy-loaded bundles.
          // Detect via the thrown message instead — confirmed in Task 4
          // smoke test: encrypted PDFs throw with message containing
          // "encrypted".
          const isEncrypted = err instanceof Error && /encrypted/i.test(err.message);
          commitMetadata(rowId, {
            pageCount: 0,
            encrypted: isEncrypted,
          });
        }
      } catch {
        commitMetadata(rowId, { pageCount: 0, encrypted: false });
      }
    }

    async function loadThumbnail(file: File, rowId: string) {
      try {
        const bytes = await file.arrayBuffer();
        const blob = await renderFirstPageThumbnail(bytes, 32);
        const url = URL.createObjectURL(blob);
        // Check outside the updater: state updaters must stay pure (Strict Mode
        // double-invokes them). Side effects belong here.
        if (!fileToId.current.has(file)) {
          URL.revokeObjectURL(url);
          return;
        }
        urlsToRevoke.current.push(url);
        setThumbs((prev) => {
          const next = new Map(prev);
          next.set(rowId, url);
          return next;
        });
      } catch {
        // Render the '?' placeholder; nothing to commit.
      }
    }

    function commitMetadata(rowId: string, patch: Partial<PdfMergeRow>) {
      const next = latestRowsRef.current.map((r) => {
        if (r.id !== rowId) return r;
        const merged: PdfMergeRow = { ...r, ...patch };
        // Re-parse range when pageCount just resolved (it may have changed
        // from undefined to a real number).
        if (patch.pageCount !== undefined && !merged.encrypted) {
          const result = parseRange(merged.rangeInput, merged.pageCount ?? 0);
          merged.parsedRange = result.ok ? result.indices : [];
          merged.rangeError = result.ok ? undefined : result.reason;
        } else if (merged.encrypted) {
          merged.parsedRange = [];
          merged.rangeError = undefined;
        }
        return merged;
      });
      latestRowsRef.current = next;
      setOptions({ rows: next });
    }
  }, [files]);

  // Sync rows when files are removed externally (rare in pdf-merge — the
  // StagingArea's × is the primary remover; this guards against any external
  // removal path).
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — keyed on files only
  useEffect(() => {
    const filesSet = new Set(files);
    const validIds = new Set<string>();
    for (const f of files) {
      const id = fileToId.current.get(f);
      if (id) validIds.add(id);
    }
    const filteredRows = options.rows.filter((r) => validIds.has(r.id));
    if (filteredRows.length === options.rows.length) return;

    for (const [f, id] of fileToId.current.entries()) {
      if (!filesSet.has(f)) {
        fileToId.current.delete(f);
        const url = thumbs.get(id);
        if (url) URL.revokeObjectURL(url);
      }
    }
    latestRowsRef.current = filteredRows;
    setOptions({ rows: filteredRows });
  }, [files]);

  useEffect(() => {
    return () => {
      for (const url of urlsToRevoke.current) URL.revokeObjectURL(url);
      urlsToRevoke.current = [];
    };
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Helpers for operations that need to keep files and rows in lockstep.
  function reorder(oldIndex: number, newIndex: number) {
    if (oldIndex === newIndex) return;
    onChange(arrayMove(files, oldIndex, newIndex));
    const next = arrayMove(options.rows, oldIndex, newIndex);
    latestRowsRef.current = next;
    setOptions({ rows: next });
  }

  function removeAt(index: number) {
    const file = files[index];
    if (file) {
      const id = fileToId.current.get(file);
      if (id) {
        const url = thumbs.get(id);
        if (url) URL.revokeObjectURL(url);
        fileToId.current.delete(file);
      }
    }
    onChange(files.filter((_, i) => i !== index));
    const next = options.rows.filter((_, i) => i !== index);
    latestRowsRef.current = next;
    setOptions({ rows: next });
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: reorder is a local fn, intentional
  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = options.rows.findIndex((r) => r.id === active.id);
      const newIndex = options.rows.findIndex((r) => r.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      reorder(oldIndex, newIndex);
    },
    [options.rows, files, onChange, setOptions],
  );

  const onRangeChange = useCallback(
    (id: string, value: string) => {
      const next = options.rows.map((r) => {
        if (r.id !== id) return r;
        if (r.pageCount === undefined) return { ...r, rangeInput: value };
        const result = parseRange(value, r.pageCount);
        return result.ok
          ? { ...r, rangeInput: value, parsedRange: result.indices, rangeError: undefined }
          : { ...r, rangeInput: value, parsedRange: [], rangeError: result.reason };
      });
      latestRowsRef.current = next;
      setOptions({ rows: next });
    },
    [options.rows, setOptions],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: reorder is a local fn, intentional
  const onMoveUp = useCallback(
    (id: string) => {
      const i = options.rows.findIndex((r) => r.id === id);
      if (i <= 0) return;
      reorder(i, i - 1);
    },
    [options.rows, files, onChange, setOptions],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: reorder is a local fn, intentional
  const onMoveDown = useCallback(
    (id: string) => {
      const i = options.rows.findIndex((r) => r.id === id);
      if (i < 0 || i >= options.rows.length - 1) return;
      reorder(i, i + 1);
    },
    [options.rows, files, onChange, setOptions],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: removeAt is a local fn, intentional
  const onRemove = useCallback(
    (id: string) => {
      const i = options.rows.findIndex((r) => r.id === id);
      if (i < 0) return;
      removeAt(i);
    },
    [options.rows, files, onChange, setOptions],
  );

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <SortableContext items={options.rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
        <div
          data-testid="pdf-merge-staging"
          className="mb-3 border border-[var(--color-hairline)] divide-y divide-[var(--color-hairline)]"
        >
          {options.rows.map((row, i) => (
            <SortableRow
              key={row.id}
              row={row}
              index={i}
              total={options.rows.length}
              thumb={{ thumbnailUrl: thumbs.get(row.id) }}
              onRangeChange={onRangeChange}
              onMoveUp={onMoveUp}
              onMoveDown={onMoveDown}
              onRemove={onRemove}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
