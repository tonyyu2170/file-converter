import { describe, expect, it } from "vitest";
import { parseProbeOutput } from "./probe";

// Synthesized stderr fragments mirror what real ffmpeg emits when
// invoked with `-i <file>` (no output). Captured originally from the
// fixture-generation verification in Task 0; abbreviated to the
// Duration + Stream lines that the parser actually consumes.

const STDERR_H264_AAC_MP4 = `
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'sample-h264-aac.mp4':
  Duration: 00:00:05.00, start: 0.000000, bitrate: 132 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 320x180, 31 kb/s, 30 fps, 30 tbr, 15360 tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, mono, fltp, 64 kb/s (default)
`;

const STDERR_VP9_OPUS_WEBM = `
Input #0, matroska,webm, from 'sample-vp9-opus.webm':
  Duration: 00:00:05.01, start: -0.007000, bitrate: 192 kb/s
  Stream #0:0(eng): Video: vp9 (Profile 1), gbrp(tv), 320x180, SAR 1:1 DAR 16:9, 30 fps, 30 tbr, 1k tbn (default)
  Stream #0:1: Audio: opus, 48000 Hz, mono, fltp (default)
`;

const STDERR_HEVC_AAC_MKV = `
Input #0, matroska,webm, from 'sample-hevc-aac.mkv':
  Duration: 00:00:05.02, start: 0.000000, bitrate: 130 kb/s
  Stream #0:0: Video: hevc (Main) (hvc1 / 0x31637668), yuv420p(tv, bt709, progressive), 320x180, SAR 1:1 DAR 16:9, 30 fps, 30 tbr, 1k tbn (default)
  Stream #0:1: Audio: aac (LC), 44100 Hz, mono, fltp (default)
`;

const STDERR_H264_NO_AUDIO_MP4 = `
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'sample-no-audio.mp4':
  Duration: 00:00:03.00, start: 0.000000, bitrate: 31 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 320x180, 30 kb/s, 30 fps, 30 tbr, 15360 tbn (default)
`;

const STDERR_H264_AAC_MOV = `
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'sample-h264.mov':
  Duration: 00:00:05.00, start: 0.000000, bitrate: 130 kb/s
  Stream #0:0(und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 320x180, 28 kb/s, 30 fps, 30 tbr, 15360 tbn (default)
  Stream #0:1(und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, mono, fltp, 64 kb/s (default)
`;

const STDERR_COVER_ART_THEN_VIDEO = `
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'music-video.mp4':
  Duration: 00:03:14.00, start: 0.000000, bitrate: 5000 kb/s
  Stream #0:0[0x1](und): Video: mjpeg (Baseline) (jpeg / 0x6745706A), yuvj420p(pc, bt470bg/unknown/unknown), 600x600 [SAR 72:72 DAR 1:1], 90k tbr, 90k tbn (attached pic)
  Stream #0:1[0x2](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1920x1080, 4800 kb/s, 30 fps, 30 tbr, 15360 tbn (default)
  Stream #0:2[0x3](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 192 kb/s (default)
`;

describe("parseProbeOutput", () => {
  it("parses H.264/AAC MP4 — codecs, dimensions, duration", () => {
    const r = parseProbeOutput(STDERR_H264_AAC_MP4);
    expect(r.videoCodec).toBe("h264");
    expect(r.audioCodec).toBe("aac");
    expect(r.hasAudio).toBe(true);
    expect(r.width).toBe(320);
    expect(r.height).toBe(180);
    expect(r.durationSec).toBeCloseTo(5.0, 2);
  });

  it("parses VP9/Opus WebM", () => {
    const r = parseProbeOutput(STDERR_VP9_OPUS_WEBM);
    expect(r.videoCodec).toBe("vp9");
    expect(r.audioCodec).toBe("opus");
    expect(r.hasAudio).toBe(true);
    expect(r.width).toBe(320);
    expect(r.height).toBe(180);
  });

  it("parses HEVC/AAC MKV", () => {
    const r = parseProbeOutput(STDERR_HEVC_AAC_MKV);
    expect(r.videoCodec).toBe("hevc");
    expect(r.audioCodec).toBe("aac");
  });

  it("parses H.264 MOV", () => {
    const r = parseProbeOutput(STDERR_H264_AAC_MOV);
    expect(r.videoCodec).toBe("h264");
    expect(r.audioCodec).toBe("aac");
  });

  it("reports hasAudio=false when there's no audio stream", () => {
    const r = parseProbeOutput(STDERR_H264_NO_AUDIO_MP4);
    expect(r.videoCodec).toBe("h264");
    expect(r.audioCodec).toBeNull();
    expect(r.hasAudio).toBe(false);
    expect(r.width).toBe(320);
    expect(r.height).toBe(180);
  });

  it("returns zeroed result for empty stderr", () => {
    const r = parseProbeOutput("");
    expect(r.videoCodec).toBeNull();
    expect(r.audioCodec).toBeNull();
    expect(r.hasAudio).toBe(false);
    expect(r.width).toBe(0);
    expect(r.height).toBe(0);
    expect(r.durationSec).toBe(0);
  });

  it("parses Duration HH:MM:SS.MS into seconds correctly", () => {
    const r = parseProbeOutput("Duration: 01:02:03.45, start: 0");
    // 1h + 2m + 3.45s = 3600 + 120 + 3.45 = 3723.45
    expect(r.durationSec).toBeCloseTo(3723.45, 2);
  });

  it("skips cover-art (attached pic) video streams", () => {
    const r = parseProbeOutput(STDERR_COVER_ART_THEN_VIDEO);
    expect(r.videoCodec).toBe("h264");
    expect(r.width).toBe(1920);
    expect(r.height).toBe(1080);
    expect(r.audioCodec).toBe("aac");
  });
});
