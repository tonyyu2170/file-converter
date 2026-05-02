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

  const ready = engine.isReadyToConvert?.(options) ?? true;
  const Panel = engine.OptionsPanel;

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

  const consumedRef = useRef(false);
  useEffect(() => {
    if (consumedRef.current) return;
    consumedRef.current = true;
    const staged = takeStagedFiles();
    if (staged.length > 0) setPendingFiles(staged);
  }, []);

  useEffect(() => {
    if (pendingFiles.length > 0 && ready) {
      const f = pendingFiles[0];
      if (f) run([f], options);
      setPendingFiles([]);
    }
  }, [pendingFiles, ready, run, options]);

  return (
    <main className="p-6">
      <div className="mb-3 flex items-center gap-3 text-[var(--text-xs)] uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        <span>tool: {engine.id}</span>
        <span>·</span>
        <StatusIndicator status={status} />
      </div>
      {Panel && <Panel value={options} onChange={setOptions} />}
      <DropZone
        accept={engine.inputAccept}
        multiple={engine.cardinality === "multi"}
        onFiles={(files) => run(files, options)}
        disabled={!ready}
      />
      {errorMessage && (
        <div className="mt-3 border border-[var(--color-accent)] p-3 text-[var(--text-sm)] text-[var(--color-fg-strong)]">
          {errorMessage}
        </div>
      )}
      <ResultList items={items} />
    </main>
  );
}
