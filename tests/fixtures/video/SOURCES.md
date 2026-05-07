# Video fixtures — sources

All five fixtures are synthesized from `lavfi`'s `testsrc` (color-bar pattern)
and `sine` (single-frequency tone) generators. No external sources, no
copyright considerations. Each is under 1 MB per CLAUDE.md committed-fixture
rule.

To regenerate from scratch on a machine with ffmpeg + libx264 + libx265 +
libvpx-vp9 + aac + libopus:

```bash
cd tests/fixtures/video

# H.264 + AAC, 320x180, 5s, MP4 — the mainstream case.
ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i 'testsrc=duration=5:size=320x180:rate=30' \
  -f lavfi -i 'sine=frequency=440:duration=5' \
  -c:v libx264 -preset veryfast -crf 28 -pix_fmt yuv420p \
  -c:a aac -b:a 96k \
  -movflags +faststart \
  sample-h264-aac.mp4

# VP9 + Opus, 320x180, 5s, WebM — exercises codec-incompat for MP4 container.
ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i 'testsrc=duration=5:size=320x180:rate=30' \
  -f lavfi -i 'sine=frequency=523:duration=5' \
  -c:v libvpx-vp9 -b:v 200k -row-mt 1 \
  -c:a libopus -b:a 64k \
  sample-vp9-opus.webm

# H.264 + AAC in MOV (iPhone-style).
ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i 'testsrc=duration=5:size=320x180:rate=30' \
  -f lavfi -i 'sine=frequency=349:duration=5' \
  -c:v libx264 -preset veryfast -crf 28 -pix_fmt yuv420p \
  -c:a aac -b:a 96k \
  sample-h264.mov

# H.265 + AAC in MKV — exercises cross-container into MP4.
ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i 'testsrc=duration=5:size=320x180:rate=30' \
  -f lavfi -i 'sine=frequency=659:duration=5' \
  -c:v libx265 -preset veryfast -crf 30 -pix_fmt yuv420p -tag:v hvc1 \
  -c:a aac -b:a 96k \
  sample-hevc-aac.mkv

# H.264 only, no audio, 3s — exercises no-audio rejection in extract-audio.
ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i 'testsrc=duration=3:size=320x180:rate=30' \
  -c:v libx264 -preset veryfast -crf 28 -pix_fmt yuv420p \
  -an \
  sample-no-audio.mp4
```

Used by:

- `src/engines/_shared/ffmpeg/probe.test.ts`
- `src/engines/_shared/trim-scrubber/frame-strip.test.ts`
- `src/engines/video-trim/index.test.ts`
- `src/engines/video-extract-audio/index.test.ts`
- `tests/e2e/video-trim-correctness.spec.ts`
- `tests/e2e/video-extract-audio-correctness.spec.ts`
- `tests/e2e/privacy-regression-video-trim.spec.ts`
