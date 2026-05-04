"use client";

import { SIZE_LIMITS_MB, hardCapBytes, softCapBytes } from "@/engines/_shared/size-limits";
import type { ConversionEngine, ConversionProgress, OutputItem } from "@/engines/_shared/types";
import { useActiveConversion } from "@/hooks/use-active-conversion";
import { formatBytes } from "@/lib/format-bytes";
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
  // Snapshot of total input bytes captured at conversion start. Used by
  // ResultList for the IN→OUT delta header. Must be a snapshot rather than
  // derived live from stagedFiles, because (especially for multi-cardinality
  // engines) the user can append more files post-conversion without clearing
  // the displayed results, which would otherwise produce a stale delta.
  const [convertedInputBytes, setConvertedInputBytes] = useState<number | null>(null);
  // Latest ConversionProgress event from the active engine. null whenever no
  // run is in flight or the active engine has not (yet) emitted progress.
  // Engines that never emit leave this null and the slot never renders —
  // backward-compatible.
  const [progress, setProgress] = useState<ConversionProgress | null>(null);

  const ready = engine.isReadyToConvert?.(options) ?? true;
  const Panel = engine.OptionsPanel;
  const Staging = engine.cardinality === "multi" ? engine.StagingArea : undefined;
  const isMulti = engine.cardinality === "multi";

  useActiveConversion(status === "converting");

  // Single-cardinality reset helper. Centralises the four-setter block used
  // by handleDrop and handleClearStaged. Multi-cardinality appends to
  // stagedFiles instead of replacing, so it does not use this.
  const resetSingleStaging = useCallback((next: File | null) => {
    setStagedFiles(next ? [next] : []);
    setItems([]);
    setErrorMessage(null);
    setStatus("ready");
    setConvertedInputBytes(null);
  }, []);

  const run = useCallback(
    async (files: File[], opts: TOptions) => {
      setErrorMessage(null);
      setItems([]);
      // Reset progress at the start of every run so a stale event from a
      // prior run cannot bleed into the new conversion's UI.
      setProgress(null);
      const inputBytesAtStart = files.reduce((sum, f) => sum + f.size, 0);
      setConvertedInputBytes(inputBytesAtStart);
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
          const result = await engine.convert(f, opts, ctrl.signal, {
            onProgress: setProgress,
          });
          const out = Array.isArray(result) ? result : [result];
          setItems(out);
          setStatus("done");
          setProgress(null);
        } catch (err) {
          setErrorMessage(err instanceof Error ? err.message : String(err));
          setStatus("error");
          setProgress(null);
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
        const result = await engine.convert(files, opts, ctrl.signal, {
          onProgress: setProgress,
        });
        setItems(Array.isArray(result) ? result : [result]);
        setStatus("done");
        setProgress(null);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
        setStatus("error");
        setProgress(null);
      }
    },
    [engine],
  );

  function handleDrop(files: File[]) {
    const hard = hardCapBytes(engine.category);
    const oversized = files.filter((f) => f.size > hard);
    if (oversized.length > 0) {
      const names = oversized.map((f) => `${f.name} (${formatBytes(f.size)})`).join(", ");
      const verb = oversized.length === 1 ? "exceeds" : "exceed";
      const filesWord = oversized.length === 1 ? "the file" : "the files";
      setErrorMessage(
        `${names} ${verb} the ${SIZE_LIMITS_MB[engine.category].hard} MB cap ` +
          `for ${engine.category} tools. Try splitting ${filesWord} or using a different tool.`,
      );
      setStatus("error");
      return;
    }
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
  const totalInputBytes = stagedFiles.reduce((sum, f) => sum + f.size, 0);

  const softBytes = softCapBytes(engine.category);
  const hardBytes = hardCapBytes(engine.category);
  const overSoft = stagedFiles.length > 0 && totalInputBytes > softBytes;
  // Aggregate hard cap only meaningful for multi (single caught at drop).
  const overHardAggregate = isMulti && totalInputBytes > hardBytes;

  // Cap warnings win over engine.convertButtonLabel: a disabled-by-cap
  // button labelled with the engine's custom string (e.g., '[ merge ]')
  // would leave the user with no explanation of why it's disabled.
  const convertLabel: string = (() => {
    if (overHardAggregate) {
      return `[ exceeds ${SIZE_LIMITS_MB[engine.category].hard} mb cap ]`;
    }
    if (overSoft) {
      return `[ convert · ${formatBytes(totalInputBytes)} may be slow ]`;
    }
    return engine.convertButtonLabel ?? "[ convert ]";
  })();

  // Estimate hook is engine-optional; cardinality narrows the call signature.
  const estimateBytes: number | null = (() => {
    if (stagedFiles.length === 0) return null;
    if (engine.cardinality === "single") {
      const f = stagedFiles[0];
      if (!f) return null;
      return engine.estimateOutputBytes?.(f, options) ?? null;
    }
    return engine.estimateOutputBytes?.(stagedFiles, options) ?? null;
  })();

  return (
    <main className="p-6">
      <div className="mb-3 flex items-center gap-3 text-[var(--text-xs)] uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        <span>tool: {engine.id}</span>
        <span>·</span>
        <StatusIndicator status={status} />
      </div>
      {progress && (
        <div
          data-testid="conversion-progress"
          className="mb-3 flex items-center gap-3 text-[var(--text-xs)] uppercase tracking-[0.1em] text-[var(--color-fg-muted)]"
        >
          {progress.kind === "model-loading" ? (
            <>
              <progress
                value={progress.loaded}
                max={progress.total}
                className="h-1 w-48 appearance-none [&::-webkit-progress-bar]:bg-[var(--color-bg)] [&::-webkit-progress-value]:bg-[var(--color-accent)]"
              />
              <span className="tabular-nums text-[var(--color-fg-strong)]">
                loading model — {(progress.loaded / 1_000_000).toFixed(1)} MB /{" "}
                {(progress.total / 1_000_000).toFixed(1)} MB
              </span>
            </>
          ) : (
            <span className="tabular-nums text-[var(--color-fg-strong)]">
              inferring — {progress.pct >= 100 ? "finishing" : "running"}
            </span>
          )}
        </div>
      )}
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
        <div className="mb-3 flex flex-wrap items-center gap-3 text-[var(--text-xs)] uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
          <span>
            current file: <span className="text-[var(--color-fg-strong)]">{stagedFile.name}</span>
            <span> · </span>
            <span className="text-[var(--color-fg-strong)]">{formatBytes(stagedFile.size)}</span>
          </span>
          {estimateBytes !== null && (
            <span data-testid="output-estimate">
              ≈ <span className="text-[var(--color-fg-strong)]">{formatBytes(estimateBytes)}</span>{" "}
              output
            </span>
          )}
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
      {isMulti && stagedFiles.length > 0 && (
        <div
          data-testid="staged-totals"
          className="mb-3 flex flex-wrap items-center gap-3 text-[var(--text-xs)] uppercase tracking-[0.1em] text-[var(--color-fg-muted)]"
        >
          <span>
            <span className="text-[var(--color-fg-strong)]">{stagedFiles.length}</span>{" "}
            {stagedFiles.length === 1 ? "file" : "files"}
            <span> · </span>
            <span className="text-[var(--color-fg-strong)]">{formatBytes(totalInputBytes)}</span>
            {overHardAggregate && (
              <>
                <span> · </span>
                <span className="text-[var(--color-fg-strong)]">
                  over {SIZE_LIMITS_MB[engine.category].hard} MB cap
                </span>
              </>
            )}
          </span>
          {estimateBytes !== null && (
            <span data-testid="output-estimate">
              ≈ <span className="text-[var(--color-fg-strong)]">{formatBytes(estimateBytes)}</span>{" "}
              output
            </span>
          )}
        </div>
      )}
      <DropZone accept={engine.inputAccept} multiple={isMulti} onFiles={handleDrop} />
      <button
        type="button"
        data-testid="convert-button"
        disabled={
          stagedFiles.length === 0 || !ready || status === "converting" || overHardAggregate
        }
        onClick={handleConvertClick}
        className="mt-3 border border-[var(--color-accent)] px-3 py-2 text-[var(--text-xs)] uppercase tracking-[0.1em] text-[var(--color-fg-strong)] disabled:border-[var(--color-fg-very-muted)] disabled:text-[var(--color-fg-very-muted)]"
      >
        {convertLabel}
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
        {...(convertedInputBytes !== null ? { inputBytes: convertedInputBytes } : {})}
      />
    </main>
  );
}
