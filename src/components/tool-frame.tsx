"use client";

import type { ConversionEngine, OutputItem } from "@/engines/_shared/types";
import { useCallback, useState } from "react";
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
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);

  const ready = engine.isReadyToConvert?.(options) ?? true;
  const Panel = engine.OptionsPanel;
  const Staging = engine.cardinality === "multi" ? engine.StagingArea : undefined;
  const isMulti = engine.cardinality === "multi";

  // Single-cardinality reset helper. Centralises the four-setter block used
  // by handleDrop and handleClearStaged. Multi-cardinality appends to
  // stagedFiles instead of replacing, so it does not use this.
  const resetSingleStaging = useCallback((next: File | null) => {
    setStagedFiles(next ? [next] : []);
    setItems([]);
    setErrorMessage(null);
    setStatus("ready");
  }, []);

  const run = useCallback(
    async (files: File[], opts: TOptions) => {
      setErrorMessage(null);
      setItems([]);
      if (engine.cardinality === "single") {
        const f = files[0];
        if (!f) return;
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

  function handleDrop(files: File[]) {
    if (isMulti) {
      setStagedFiles((prev) => [...prev, ...files]);
      return;
    }
    const first = files[0];
    if (!first) return;
    resetSingleStaging(first);
  }

  function handleConvertClick() {
    run(stagedFiles, options);
  }

  function handleClearStaged() {
    resetSingleStaging(null);
  }

  // Compute archiveBasename for multi-output ZIP downloads from the currently
  // staged file. With staged-on-drop semantics, stagedFiles[0] is the single
  // source of truth for the input file across both cardinalities.
  const archiveBasename = (() => {
    const sourceFile = stagedFiles[0];
    if (!sourceFile) return undefined;
    return sourceFile.name.replace(/\.[^.]+$/, "");
  })();

  const stagedFile: File | undefined = stagedFiles[0];

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
      {!isMulti && stagedFile && (
        <div className="mb-3 flex items-center gap-3 text-[var(--text-xs)] uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
          <span>
            current file: <span className="text-[var(--color-fg-strong)]">{stagedFile.name}</span>
          </span>
          <button
            type="button"
            data-testid="clear-staged-file"
            disabled={status === "converting"}
            onClick={handleClearStaged}
            className="text-[var(--color-accent)] hover:text-[var(--color-fg-strong)] disabled:text-[var(--color-fg-very-muted)]"
          >
            [ clear ]
          </button>
        </div>
      )}
      <DropZone accept={engine.inputAccept} multiple={isMulti} onFiles={handleDrop} />
      <button
        type="button"
        data-testid="convert-button"
        disabled={stagedFiles.length === 0 || !ready || status === "converting"}
        onClick={handleConvertClick}
        className="mt-3 border border-[var(--color-accent)] px-3 py-2 text-[var(--text-xs)] uppercase tracking-[0.1em] text-[var(--color-fg-strong)] disabled:border-[var(--color-fg-very-muted)] disabled:text-[var(--color-fg-very-muted)]"
      >
        {engine.convertButtonLabel ?? "[ convert ]"}
      </button>
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
