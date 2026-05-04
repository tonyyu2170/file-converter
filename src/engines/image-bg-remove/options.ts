export type ImageBgRemoveBgMode = "transparent" | "solid";
export type ImageBgRemoveOutputFormat = "png" | "jpeg";

export type ImageBgRemoveOptions = {
  bgMode: ImageBgRemoveBgMode;
  bgColor: string; // #RRGGBB; ignored when bgMode === "transparent"
  outputFormat: ImageBgRemoveOutputFormat;
  jpegQuality: number; // 0.1..1.0; ignored when outputFormat === "png"
};

export const defaultImageBgRemoveOptions: ImageBgRemoveOptions = {
  bgMode: "transparent",
  bgColor: "#ffffff",
  outputFormat: "png",
  jpegQuality: 0.92,
};

export const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** Cross-rule clamping. transparent + jpeg is invalid (JPEG has no alpha);
 * jpeg + transparent-preset is invalid for the same reason. The panel
 * calls this on every onChange so callers see a valid state. */
export function clampOptions(next: ImageBgRemoveOptions): ImageBgRemoveOptions {
  if (next.bgMode === "transparent") return { ...next, outputFormat: "png" };
  return next;
}
