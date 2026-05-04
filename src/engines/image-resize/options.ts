export type ImageResizeMode = "px" | "percent";

export type ImageResizeOptions = {
  width: number;
  height: number;
  mode: ImageResizeMode;
  lockAspectRatio: boolean;
};

export const defaultImageResizeOptions: ImageResizeOptions = {
  width: 1920,
  height: 1080,
  mode: "px",
  lockAspectRatio: true,
};

// Output MIME for a given input MIME. HEIC inputs fall back to PNG
// (no HEIC encoder available in the browser canvas).
export const OUTPUT_MIME_FOR_INPUT: Record<string, string> = {
  "image/heic": "image/png",
  "image/heif": "image/png",
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/webp": "image/webp",
};

// Filename extension for each output MIME.
export const OUTPUT_EXTENSION: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
