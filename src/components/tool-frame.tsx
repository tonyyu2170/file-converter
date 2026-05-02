"use client";

import type { ConversionEngine, OutputItem } from "@/engines/_shared/types";
import { takeStagedFiles } from "@/lib/handoff";
import { useCallback, useEffect, useRef, useState } from "react";
import { DropZone } from "./drop-zone";
import { ResultList } from "./result-list";
import { type Status, StatusIndicator } from "./status-indicator";

type Props<TOptions> = {
  engine: ConversionEngine<TOptions, OutputItem | OutputItem[]>;
};

export function ToolFrame<TOptions>({ engine }: Props<TOptions>) {
  const [status, setStatus] = useState<Status>("ready");
  const [items, setItems] = useState<OutputItem[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [options, setOptions] = useState<TOptions>(engine.defaultOptions);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [singleSourceFile, setSingleSourceFile] = useState<File | null>(null);

  const ready = engine.isReadyToConvert?.(options) ?? true;
  const Panel = engine.OptionsPanel;
  const Staging = engine.cardinality === "multi" ? engine.StagingArea : undefined;
  const isMulti = engine.cardinality === "multi";

  const run = useCallback(
    async (files: File[], opts: TOptions) => {
      setErrorMessage(null);
      setItems([]);
      if (engine.cardinality === "single") {
        const f = files[0];
        if (!f) return;
        setSingleSourceFile(f);
        const v = engine.validate(f, opts);
        if (!v.ok) {
          setErrorMessage(v.reason);
          setStatus("error");
          return;
        }
        setStatus("converting");
        try {
          const ctrl = new AbortController();
          const result = await engine.convert(f, opts, ctrl.signal);
          const out = Array.isArray(result) ? result : [result];
          setItems(out);
          setStatus("done");
        } catch (err) {
          setErrorMessage(err instanceof Error ? err.message : String(err));
          setStatus("error");
        }
        return;
      }

      const v = engine.validate(files, opts);
      if (!v.ok) {
        setErrorMessage(v.reason);
        setStatus("error");
        return;
      }
      setStatus("converting");
      try {
        const ctrl = new AbortController();
        const result = await engine.convert(files, opts, ctrl.signal);
        setItems(Array.isArray(result) ? result : [result]);
        setStatus("done");
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    },
    [engine],
  );

  // Mount-time staged-file consumption. Single-shot: takeStagedFiles clears
  // the slot, so React Strict Mode's double-mount fires this once net.
  const consumedRef = useRef(false);
  useEffect(() => {
    if (consumedRef.current) return;
    consumedRef.current = true;
    const staged = takeStagedFiles();
    if (staged.length > 0) setPendingFiles(staged);
  }, []);

  // Single-cardinality: fire conversion when both file and ready materialize.
  // Multi-cardinality: populate the staging area (no auto-fire — user reviews
  // and clicks Convert).
  useEffect(() => {
    if (pendingFiles.length === 0) return;
    if (isMulti) {
      setStagedFiles((prev) => [...prev, ...pendingFiles]);
      setPendingFiles([]);
      return;
    }
    if (ready) {
      const f = pendingFiles[0];
      if (f) run([f], options);
      setPendingFiles([]);
    }
  }, [pendingFiles, ready, run, options, isMulti]);

  function handleDrop(files: File[]) {
    if (isMulti) {
      // Multi: append to staging.
      setStagedFiles((prev) => [...prev, ...files]);
      return;
    }
    // Single: fire conversion immediately.
    run(files, options);
  }

  function handleConvertClick() {
    run(stagedFiles, options);
  }

  // Compute archiveBasename for multi-output ZIP downloads. Single-cardinality
  // engines: strip the extension from the input file's name. Multi-cardinality
  // engines: use the first staged file's basename, or undefined if none staged.
  const archiveBasename = (() => {
    const sourceFile =
      engine.cardinality === "single" ? singleSourceFile : (stagedFiles[0] ?? null);
    if (!sourceFile) return undefined;
    return sourceFile.name.replace(/\.[^.]+$/, "");
  })();

  return (
    <main className="p-6">
      <div className="mb-3 flex items-center gap-3 text-[var(--text-xs)] uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        <span>tool: {engine.id}</span>
        <span>·</span>
        <StatusIndicator status={status} />
      </div>
      {Panel && <Panel value={options} onChange={setOptions} />}
      {Staging && stagedFiles.length > 0 && (
        <Staging
          files={stagedFiles}
          onChange={setStagedFiles}
          options={options}
          setOptions={setOptions}
        />
      )}
      <DropZone
        accept={engine.inputAccept}
        multiple={isMulti}
        onFiles={handleDrop}
        disabled={!isMulti && !ready}
      />
      {isMulti && (
        <button
          type="button"
          data-testid="convert-button"
          disabled={stagedFiles.length === 0 || !ready || status === "converting"}
          onClick={handleConvertClick}
          className="mt-3 border border-[var(--color-accent)] px-3 py-2 text-[var(--text-xs)] uppercase tracking-[0.1em] text-[var(--color-fg-strong)] disabled:border-[var(--color-fg-very-muted)] disabled:text-[var(--color-fg-very-muted)]"
        >
          {engine.convertButtonLabel ?? "[ convert ]"}
        </button>
      )}
      {errorMessage && (
        <div className="mt-3 border border-[var(--color-accent)] p-3 text-[var(--text-sm)] text-[var(--color-fg-strong)]">
          {errorMessage}
        </div>
      )}
      <ResultList
        items={items}
        {...(archiveBasename !== undefined ? { archiveBasename } : {})}
        {...(engine.archiveSuffix !== undefined ? { archiveSuffix: engine.archiveSuffix } : {})}
      />
    </main>
  );
}
