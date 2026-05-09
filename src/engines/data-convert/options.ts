// src/engines/data-convert/options.ts
export type DataConvertFormat = "csv" | "json" | "yaml";

export type DataConvertOptions = {
  outputFormat: DataConvertFormat;
};

export const defaultDataConvertOptions: DataConvertOptions = {
  outputFormat: "json",
};

export function extensionFor(fmt: DataConvertFormat): string {
  return fmt;
}

export function mimeFor(fmt: DataConvertFormat): string {
  switch (fmt) {
    case "csv":
      return "text/csv";
    case "json":
      return "application/json";
    case "yaml":
      return "application/yaml";
  }
}
