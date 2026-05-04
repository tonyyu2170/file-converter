import { type ImageResizeOptions, OUTPUT_EXTENSION, OUTPUT_MIME_FOR_INPUT } from "./options";

export const MAX_DIMENSION = 16384; // canvas hard limit on most browsers

export type SourceDimensions = { width: number; height: number };
export type TargetDimensions = { width: number; height: number };

/**
 * Compute the resize target dimensions from source dimensions + user
 * options. When `lockAspectRatio` is on, only width drives the result;
 * height is computed from the source aspect ratio (px mode) or scaled
 * by the same percent as width (percent mode).
 *
 * Throws when the computed target is < 1px or > MAX_DIMENSION on
 * either axis.
 */
export function computeTargetDimensions(
  source: SourceDimensions,
  opts: ImageResizeOptions,
): TargetDimensions {
  let width: number;
  let height: number;

  if (opts.mode === "percent") {
    width = Math.round((source.width * opts.width) / 100);
    height = opts.lockAspectRatio
      ? Math.round((source.height * opts.width) / 100)
      : Math.round((source.height * opts.height) / 100);
  } else {
    width = opts.width;
    height = opts.lockAspectRatio
      ? Math.round((source.height * opts.width) / source.width)
      : opts.height;
  }

  if (width < 1 || height < 1) {
    throw new Error(`Resize target too small: ${width}x${height}`);
  }
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new Error(`Resize target exceeds canvas limit (${MAX_DIMENSION}px): ${width}x${height}`);
  }

  return { width, height };
}

/**
 * Derive the output filename, MIME, and extension for a given input
 * file and target dimensions. HEIC inputs always output PNG (no
 * canvas HEIC encoder).
 */
export function deriveOutput(
  inputName: string,
  inputType: string,
  target: TargetDimensions,
): { filename: string; mime: string; ext: string } {
  const mime = OUTPUT_MIME_FOR_INPUT[inputType] ?? "image/png";
  const ext = OUTPUT_EXTENSION[mime] ?? "png";
  // HEIC inputs change extension; non-HEIC keep theirs (resolution
  // suffix already prevents source-file collision).
  const baseName =
    inputType === "image/heic" || inputType === "image/heif"
      ? replaceExt(inputName, ext)
      : inputName;
  return {
    filename: withResolutionSuffix(baseName, target.width, target.height, ext),
    mime,
    ext,
  };
}

function replaceExt(name: string, newExt: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name}.${newExt}`;
  return `${name.slice(0, dot)}.${newExt}`;
}

function withResolutionSuffix(name: string, w: number, h: number, ext: string): string {
  const base = name.lastIndexOf(".") > 0 ? name.slice(0, name.lastIndexOf(".")) : name;
  return `${base}-${w}x${h}.${ext}`;
}
