// Engine-specific options + format helpers for video-convert.
//
// Output format set is strict per v2 design §3.2: mp4, mov, webm.
// Input set (handled in index.ts validate) is broader to match video-trim.

export type VideoConvertFormat = "mp4" | "mov" | "webm";
export type VideoConvertQuality = "low" | "medium" | "high";

export const VIDEO_CONVERT_FORMATS: ReadonlyArray<VideoConvertFormat> = ["mp4", "mov", "webm"];

export const VIDEO_CONVERT_QUALITY_LEVELS: ReadonlyArray<VideoConvertQuality> = [
  "low",
  "medium",
  "high",
];

// CRF (constant-rate-factor) values per v2 design §3.2.
// Lower CRF = higher quality + larger file. The same scale is meaningful
// for both libx264 and libvpx-vp9 in the 18–28 band, so a single map works.
export const CRF_BY_QUALITY: Record<VideoConvertQuality, number> = {
  low: 28,
  medium: 23,
  high: 18,
};

export const OUTPUT_EXTENSION: Record<VideoConvertFormat, string> = {
  mp4: "mp4",
  mov: "mov",
  webm: "webm",
};

export const OUTPUT_MIME: Record<VideoConvertFormat, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

export function videoCodec(fmt: VideoConvertFormat): string {
  // WebM uses libvpx (VP8) rather than libvpx-vp9: the VP9 encoder in the
  // current @ffmpeg/core build OOBs on real inputs (memory access out of
  // bounds in libvpx, regardless of cpu-used / row-mt / tile-columns
  // settings). VP8 + Opus is a fully browser-supported webm combination
  // and the libvpx VP8 path is battle-tested in ffmpeg.wasm.
  return fmt === "webm" ? "libvpx" : "libx264";
}

export function audioCodec(fmt: VideoConvertFormat): string {
  return fmt === "webm" ? "libopus" : "aac";
}

export type VideoConvertOptions = {
  outputFormat: VideoConvertFormat | null;
  quality: VideoConvertQuality;
};

export const defaultVideoConvertOptions: VideoConvertOptions = {
  outputFormat: null,
  quality: "medium",
};
