import type { ComponentType } from "react";

export type ValidationResult = { ok: true } | { ok: false; reason: string };

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

export type EngineMeta<TOptions> = {
  id: string;
  inputAccept: string[];
  inputMime: string[];
  outputMime: string;
  defaultOptions: TOptions;
  convertButtonLabel?: string;
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
  convert(file: File, opts: TOptions, signal: AbortSignal): Promise<TOutput>;
  isReadyToConvert?: (opts: TOptions) => boolean;
  OptionsPanel?: ComponentType<OptionsPanelProps<TOptions>>;
};

export type MultiInputEngine<
  TOptions,
  TOutput extends OutputItem | OutputItem[],
> = EngineMeta<TOptions> & {
  cardinality: "multi";
  validate(files: File[], opts: TOptions): ValidationResult;
  convert(files: File[], opts: TOptions, signal: AbortSignal): Promise<TOutput>;
  isReadyToConvert?: (opts: TOptions) => boolean;
  OptionsPanel?: ComponentType<OptionsPanelProps<TOptions>>;
  StagingArea?: ComponentType<StagingAreaProps<TOptions>>;
};

export type ConversionEngine<
  TOptions = unknown,
  TOutput extends OutputItem | OutputItem[] = OutputItem | OutputItem[],
> = SingleInputEngine<TOptions, TOutput> | MultiInputEngine<TOptions, TOutput>;
