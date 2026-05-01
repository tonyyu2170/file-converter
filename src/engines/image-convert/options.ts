export type ImageConvertOutputFormat = "png" | "jpeg" | "webp";

export type ImageConvertOptions = {
  output: ImageConvertOutputFormat | null;
  quality: number;
};

export const defaultImageConvertOptions: ImageConvertOptions = {
  output: null,
  quality: 0.9,
};

export const OUTPUT_MIME: Record<ImageConvertOutputFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export const OUTPUT_EXTENSION: Record<ImageConvertOutputFormat, string> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp",
};
