// src/engines/video-trim/options-panel.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultVideoTrimOptions } from "./options";
import { VideoTrimOptionsPanel } from "./options-panel";

const { runProbeMock, runExtractFrameStripMock } = vi.hoisted(() => ({
  runProbeMock: vi.fn(),
  runExtractFrameStripMock: vi.fn(),
}));

vi.mock("./index", () => ({
  getVideoTrimHarness: () => ({
    runProbe: runProbeMock,
    runExtractFrameStrip: runExtractFrameStripMock,
  }),
}));

vi.mock("@/engines/_shared/trim-scrubber/duration", () => ({
  readMediaDurationSec: vi.fn().mockResolvedValue(5),
}));

beforeEach(() => {
  runProbeMock.mockReset();
  runExtractFrameStripMock.mockReset();
  runProbeMock.mockResolvedValue({
    durationSec: 5,
    videoCodec: "vp9",
    audioCodec: "opus",
    width: 320,
    height: 180,
    hasAudio: true,
  });
  runExtractFrameStripMock.mockResolvedValue({ urls: [], widthPx: 107 });
});

describe("VideoTrimOptionsPanel", () => {
  it("renders the container <select> with all four entries", async () => {
    const file = new File([new Uint8Array([1])], "x.webm", {
      type: "video/webm",
    });
    render(
      <VideoTrimOptionsPanel
        value={defaultVideoTrimOptions}
        onChange={() => {}}
        file={file}
      />,
    );
    const select = await screen.findByTestId("video-trim-container");
    const options = Array.from(select.querySelectorAll("option")).map(
      (o) => o.value,
    );
    expect(options).toEqual(["same", "mp4", "webm", "mkv"]);
  });

  it("disables MP4 when probe reports VP9 + Opus", async () => {
    const file = new File([new Uint8Array([1])], "x.webm", {
      type: "video/webm",
    });
    render(
      <VideoTrimOptionsPanel
        value={defaultVideoTrimOptions}
        onChange={() => {}}
        file={file}
      />,
    );
    const select = await screen.findByTestId("video-trim-container");
    await waitFor(() => {
      const mp4 = select.querySelector(
        'option[value="mp4"]',
      ) as HTMLOptionElement;
      expect(mp4.disabled).toBe(true);
    });
    const same = select.querySelector(
      'option[value="same"]',
    ) as HTMLOptionElement;
    const mkv = select.querySelector(
      'option[value="mkv"]',
    ) as HTMLOptionElement;
    const webm = select.querySelector(
      'option[value="webm"]',
    ) as HTMLOptionElement;
    expect(same.disabled).toBe(false);
    expect(mkv.disabled).toBe(false);
    expect(webm.disabled).toBe(false);
  });

  it("shows the failed-codecs hint and falls back to same-only when probe rejects", async () => {
    runProbeMock.mockRejectedValueOnce(new Error("unrecognised codec"));
    const file = new File([new Uint8Array([1])], "x.mkv", {
      type: "video/x-matroska",
    });
    render(
      <VideoTrimOptionsPanel
        value={defaultVideoTrimOptions}
        onChange={() => {}}
        file={file}
      />,
    );
    // Wait for the failure hint to appear.
    await waitFor(() => {
      expect(
        screen.getByText(/couldn't read codecs — only "same" available/i),
      ).toBeTruthy();
    });
    // All non-"same" options must be disabled in the fail-soft state.
    const select = screen.getByTestId("video-trim-container");
    const mp4 = select.querySelector(
      'option[value="mp4"]',
    ) as HTMLOptionElement;
    const webm = select.querySelector(
      'option[value="webm"]',
    ) as HTMLOptionElement;
    const mkv = select.querySelector(
      'option[value="mkv"]',
    ) as HTMLOptionElement;
    const same = select.querySelector(
      'option[value="same"]',
    ) as HTMLOptionElement;
    expect(mp4.disabled).toBe(true);
    expect(webm.disabled).toBe(true);
    expect(mkv.disabled).toBe(true);
    expect(same.disabled).toBe(false);
  });
});
