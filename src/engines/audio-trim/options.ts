import { OUTPUT_EXTENSION, OUTPUT_MIME } from "@/engines/_shared/audio/format";

export type AudioTrimFormat = "same" | "mp3" | "wav" | "m4a" | "flac";
export type AudioTrimBitrate = 64 | 128 | 192 | 256 | 320;

export type AudioTrimOptions = {
  startSec: number;
  endSec: number;
  outputFormat: AudioTrimFormat;
  /** Ignored at runtime when outputFormat is "same" or a lossless codec. */
  bitrate: AudioTrimBitrate;
};

export const AUDIO_TRIM_FORMATS: ReadonlyArray<AudioTrimFormat> = [
  "same",
  "mp3",
  "wav",
  "m4a",
  "flac",
];

export const AUDIO_TRIM_BITRATE_OPTIONS: ReadonlyArray<AudioTrimBitrate> = [64, 128, 192, 256, 320];

export const defaultAudioTrimOptions: AudioTrimOptions = {
  startSec: 0,
  endSec: 0,
  outputFormat: "same",
  bitrate: 192,
};

export function isLossyOutput(fmt: AudioTrimFormat): boolean {
  return fmt === "mp3" || fmt === "m4a";
}

function extensionOf(name: string): string {
  return (name.split(".").pop() ?? "").toLowerCase();
}

export function outputExtensionFor(fmt: AudioTrimFormat, inputName: string): string {
  if (fmt === "same") return extensionOf(inputName);
  return OUTPUT_EXTENSION[fmt];
}

export function outputMimeFor(fmt: AudioTrimFormat, inputMime: string): string {
  if (fmt === "same") return inputMime;
  return OUTPUT_MIME[fmt];
}
