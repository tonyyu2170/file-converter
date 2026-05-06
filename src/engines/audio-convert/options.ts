export type AudioConvertFormat = "mp3" | "wav" | "m4a" | "flac";
export type AudioBitrate = 64 | 128 | 192 | 256 | 320;

export type AudioConvertOptions = {
  outputFormat: AudioConvertFormat | null;
  bitrate: AudioBitrate;
};

export const defaultAudioConvertOptions: AudioConvertOptions = {
  outputFormat: null,
  bitrate: 192,
};

export const OUTPUT_MIME: Record<AudioConvertFormat, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  flac: "audio/flac",
};

export const OUTPUT_EXTENSION: Record<AudioConvertFormat, string> = {
  mp3: "mp3",
  wav: "wav",
  m4a: "m4a",
  flac: "flac",
};

export const AUDIO_FORMAT_LOSSY: Record<AudioConvertFormat, boolean> = {
  mp3: true,
  m4a: true,
  wav: false,
  flac: false,
};

export const AUDIO_BITRATE_OPTIONS: ReadonlyArray<AudioBitrate> = [64, 128, 192, 256, 320];

export function isLossy(fmt: AudioConvertFormat): boolean {
  return AUDIO_FORMAT_LOSSY[fmt];
}
