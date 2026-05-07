// src/engines/audio-convert/options.ts
//
// Engine-specific options shape. Format helpers live in
// `_shared/audio/format` and are re-exported here so existing callers
// that imported from this path keep working.

import type { AudioBitrate, AudioFormat } from "@/engines/_shared/audio/format";

export {
  AUDIO_BITRATE_OPTIONS,
  AUDIO_FORMAT_LOSSY,
  isLossy,
  OUTPUT_EXTENSION,
  OUTPUT_MIME,
  type AudioBitrate,
  type AudioFormat,
} from "@/engines/_shared/audio/format";

// audio-convert names its format type with a nullable null sentinel for
// "user has not picked yet". Keep the alias so engine code reads naturally.
export type AudioConvertFormat = AudioFormat;

export type AudioConvertOptions = {
  outputFormat: AudioConvertFormat | null;
  bitrate: AudioBitrate;
};

export const defaultAudioConvertOptions: AudioConvertOptions = {
  outputFormat: null,
  bitrate: 192,
};
