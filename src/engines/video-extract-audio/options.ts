// src/engines/video-extract-audio/options.ts
import {
  AUDIO_BITRATE_OPTIONS,
  type AudioBitrate,
  type AudioFormat,
  OUTPUT_EXTENSION,
  OUTPUT_MIME,
  isLossy,
} from "@/engines/_shared/audio/format";

export type VideoExtractAudioFormat = "same" | AudioFormat;

export type VideoExtractAudioOptions = {
  outputFormat: VideoExtractAudioFormat;
  bitrate: AudioBitrate;
};

export const VIDEO_EXTRACT_AUDIO_FORMATS: ReadonlyArray<VideoExtractAudioFormat> = [
  "same",
  "mp3",
  "wav",
  "m4a",
  "flac",
];

export const defaultVideoExtractAudioOptions: VideoExtractAudioOptions = {
  outputFormat: "same",
  bitrate: 192,
};

export { AUDIO_BITRATE_OPTIONS, isLossy, OUTPUT_EXTENSION, OUTPUT_MIME };

// "same" output container is decided at runtime from the probe's audioCodec.
// This table maps probed audio codec → output extension and MIME for the
// -c copy path.
export const SAME_OUTPUT_FOR_CODEC: Record<string, { ext: string; mime: string }> = {
  aac: { ext: "m4a", mime: "audio/mp4" },
  mp3: { ext: "mp3", mime: "audio/mpeg" },
  opus: { ext: "opus", mime: "audio/ogg" },
  vorbis: { ext: "ogg", mime: "audio/ogg" },
  flac: { ext: "flac", mime: "audio/flac" },
  pcm_s16le: { ext: "wav", mime: "audio/wav" },
  pcm_s16be: { ext: "wav", mime: "audio/wav" },
  pcm_f32le: { ext: "wav", mime: "audio/wav" },
};

export const SAME_OUTPUT_FALLBACK = { ext: "mka", mime: "audio/x-matroska" };

export function sameOutputFor(codec: string | null): { ext: string; mime: string } {
  if (!codec) return SAME_OUTPUT_FALLBACK;
  // PCM family always fits WAV — match ffmpeg's pcm_* codec naming
  // (pcm_s16le / s24le / s32le / s16be / f32le / u8 / alaw / mulaw / ...).
  if (codec.startsWith("pcm_")) return { ext: "wav", mime: "audio/wav" };
  return SAME_OUTPUT_FOR_CODEC[codec] ?? SAME_OUTPUT_FALLBACK;
}
