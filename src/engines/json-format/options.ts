// src/engines/json-format/options.ts
export type JsonFormatMode = "pretty" | "minify";
export type JsonFormatIndent = 2 | 4 | "tab";

export type JsonFormatOptions = {
  mode: JsonFormatMode;
  indent: JsonFormatIndent;
};

export const defaultJsonFormatOptions: JsonFormatOptions = {
  mode: "pretty",
  indent: 2,
};

export function indentArg(opts: JsonFormatOptions): number | string {
  if (opts.mode === "minify") return 0;
  if (opts.indent === "tab") return "\t";
  return opts.indent;
}
