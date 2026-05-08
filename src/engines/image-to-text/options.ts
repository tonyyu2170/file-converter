export type ImageToTextOutputFormat = "txt" | "json-with-bboxes";

export type ImageToTextOptions = {
  outputFormat: ImageToTextOutputFormat;
};

export const defaultImageToTextOptions: ImageToTextOptions = {
  outputFormat: "txt",
};

export function outputExtensionFor(opts: ImageToTextOptions): string {
  return opts.outputFormat === "txt" ? "txt" : "json";
}

export function outputMimeFor(opts: ImageToTextOptions): string {
  return opts.outputFormat === "txt" ? "text/plain" : "application/json";
}
