// src/engines/video-trim/options-panel.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultVideoTrimOptions } from "./options";
import { VideoTrimOptionsPanel } from "./options-panel";

vi.mock("./index", () => ({
  getVideoTrimHarness: () => ({
    runProbe: vi.fn().mockResolvedValue({
      durationSec: 5,
      videoCodec: "vp9",
      audioCodec: "opus",
      width: 320,
      height: 180,
      hasAudio: true,
    }),
    runExtractFrameStrip: vi
      .fn()
      .mockResolvedValue({ urls: [], widthPx: 107 }),
  }),
}));

vi.mock("@/engines/_shared/trim-scrubber/duration", () => ({
  readMediaDurationSec: vi.fn().mockResolvedValue(5),
}));

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
});
