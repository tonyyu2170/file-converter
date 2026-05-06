# audio fixtures

All fixtures are deterministic 440 Hz sine waves at 44.1 kHz stereo, 5 seconds
long. Generated locally with `ffmpeg -f lavfi -i "sine=frequency=440:duration=5"
-ar 44100 -ac 2 ...`. No third-party licensing concerns; regenerable from a
single ffmpeg command.

| File | Format | Codec | Bitrate / sample format |
|---|---|---|---|
| sample.mp3 | MP3 | libmp3lame | 192 kbps |
| sample.wav | WAV | pcm_s16le (lossless) | uncompressed |
| sample.m4a | M4A | aac | 192 kbps |
| sample.flac | FLAC | flac (lossless) | uncompressed |

Why a sine wave: the goal of the correctness E2E is not perceptual quality but
**format-correct output bytes**. A sine wave is deterministic and small; the
test asserts magic bytes, duration, and (for lossy formats) approximate file
size — properties that don't depend on input content.
