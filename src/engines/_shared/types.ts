export type ValidationResult = { ok: true } | { ok: false; reason: string };

export type OutputItem = {
  filename: string;
  mime: string;
  blob: Blob;
};

export type EngineMeta<TOptions> = {
  id: string;
  inputAccept: string[];
  inputMime: string[];
  outputMime: string;
  defaultOptions: TOptions;
};

export type SingleInputEngine<
  TOptions,
  TOutput extends OutputItem | OutputItem[],
> = EngineMeta<TOptions> & {
  cardinality: "single";
  validate(file: File, opts: TOptions): ValidationResult;
  convert(file: File, opts: TOptions, signal: AbortSignal): Promise<TOutput>;
};

export type MultiInputEngine<
  TOptions,
  TOutput extends OutputItem | OutputItem[],
> = EngineMeta<TOptions> & {
  cardinality: "multi";
  validate(files: File[], opts: TOptions): ValidationResult;
  convert(files: File[], opts: TOptions, signal: AbortSignal): Promise<TOutput>;
};

export type ConversionEngine<
  TOptions = unknown,
  TOutput extends OutputItem | OutputItem[] = OutputItem | OutputItem[],
> = SingleInputEngine<TOptions, TOutput> | MultiInputEngine<TOptions, TOutput>;
