import type { ComponentType } from "react";

export type ValidationResult = { ok: true } | { ok: false; reason: string };

/**
 * Multi-stage progress event a worker can emit during conversion. Used by
 * engines with heavy cold-start costs (e.g., ML model loading) so the host
 * can render a meaningful progress UI rather than an indeterminate spinner.
 *
 * - `model-loading`: bytes-based progress while fetching/initialising assets.
 * - `inference`: 0-100 percentage during the conversion itself.
 *
 * Engines that don't emit progress simply never call the callback.
 */
export type ConversionProgress =
  | { kind: "model-loading"; loaded: number; total: number }
  | { kind: "inference"; pct: number };

export type OutputItem = {
  filename: string;
  mime: string;
  blob: Blob;
  /**
   * Engine-emitted notices about content the conversion could not fully
   * preserve (e.g., docx-to-pdf's skip-with-warning categories: equations,
   * drawings, RTL). Optional; existing engines that produce verbatim output
   * leave this unset. Surfaced by ResultList as a one-line note below the
   * filename.
   */
  warnings?: string[];
};

export type EngineCategory = "image" | "pdf" | "document";

export type EngineMeta<TOptions> = {
  id: string;
  inputAccept: string[];
  inputMime: string[];
  outputMime: string;
  defaultOptions: TOptions;
  convertButtonLabel?: string;
  category: EngineCategory;
  /** Filename suffix for ZIP archive when an engine produces multiple
   * outputs. ResultList builds the archive as `<basename><archiveSuffix>.zip`
   * (e.g., "myfile" + "-split" → "myfile-split.zip"). Engines that always
   * produce a single output don't need to set this. */
  archiveSuffix?: string;
};

export type OptionsPanelProps<TOptions> = {
  value: TOptions;
  onChange: (next: TOptions) => void;
};

export type StagingAreaProps<TOptions> = {
  files: File[];
  onChange: (next: File[]) => void;
  options: TOptions;
  setOptions: (next: TOptions) => void;
};

export type SingleInputEngine<
  TOptions,
  TOutput extends OutputItem | OutputItem[],
> = EngineMeta<TOptions> & {
  cardinality: "single";
  validate(file: File, opts: TOptions): ValidationResult;
  convert(
    file: File,
    opts: TOptions,
    signal: AbortSignal,
    runOpts?: { onProgress?: (p: ConversionProgress) => void },
  ): Promise<TOutput>;
  isReadyToConvert?: (opts: TOptions) => boolean;
  /** Optional: a tight, pre-conversion estimate of total output bytes.
   * Return `null` when an honest estimate isn't possible for the current
   * inputs/options (e.g., not enough files, content-dependent compression).
   * Engines must only implement this when the estimate is reliably close —
   * a misleading number is worse than no number. */
  estimateOutputBytes?: (file: File, opts: TOptions) => number | null;
  OptionsPanel?: ComponentType<OptionsPanelProps<TOptions>>;
};

export type MultiInputEngine<
  TOptions,
  TOutput extends OutputItem | OutputItem[],
> = EngineMeta<TOptions> & {
  cardinality: "multi";
  validate(files: File[], opts: TOptions): ValidationResult;
  convert(
    files: File[],
    opts: TOptions,
    signal: AbortSignal,
    runOpts?: { onProgress?: (p: ConversionProgress) => void },
  ): Promise<TOutput>;
  isReadyToConvert?: (opts: TOptions) => boolean;
  /** See SingleInputEngine.estimateOutputBytes. */
  estimateOutputBytes?: (files: File[], opts: TOptions) => number | null;
  OptionsPanel?: ComponentType<OptionsPanelProps<TOptions>>;
  StagingArea?: ComponentType<StagingAreaProps<TOptions>>;
};

export type ConversionEngine<
  TOptions = unknown,
  TOutput extends OutputItem | OutputItem[] = OutputItem | OutputItem[],
> = SingleInputEngine<TOptions, TOutput> | MultiInputEngine<TOptions, TOutput>;
