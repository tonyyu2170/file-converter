// src/engines/_shared/audio/format.ts
//
// Shared audio-format metadata for engines that re-encode audio
// (audio-convert, audio-trim, video-extract-audio). Pure data + pure
// helpers — no runtime dependencies.

export type AudioFormat = "mp3" | "wav" | "m4a" | "flac";
export type AudioBitrate = 64 | 128 | 192 | 256 | 320;

export const OUTPUT_MIME: Record<AudioFormat, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  flac: "audio/flac",
};

export const OUTPUT_EXTENSION: Record<AudioFormat, string> = {
  mp3: "mp3",
  wav: "wav",
  m4a: "m4a",
  flac: "flac",
};

export const AUDIO_FORMAT_LOSSY: Record<AudioFormat, boolean> = {
  mp3: true,
  m4a: true,
  wav: false,
  flac: false,
};

export const AUDIO_BITRATE_OPTIONS: ReadonlyArray<AudioBitrate> = [
  64, 128, 192, 256, 320,
];

export function isLossy(fmt: AudioFormat): boolean {
  return AUDIO_FORMAT_LOSSY[fmt];
}
