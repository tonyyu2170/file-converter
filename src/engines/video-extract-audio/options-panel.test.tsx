// src/engines/video-extract-audio/options-panel.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultVideoExtractAudioOptions } from "./options";
import { VideoExtractAudioOptionsPanel } from "./options-panel";

const { runProbeMock } = vi.hoisted(() => ({
  runProbeMock: vi.fn(),
}));

vi.mock("./index", () => ({
  getVideoExtractAudioHarness: () => ({
    runProbe: runProbeMock,
  }),
}));

beforeEach(() => {
  runProbeMock.mockReset();
  runProbeMock.mockResolvedValue({ hasAudio: true });
});

describe("VideoExtractAudioOptionsPanel", () => {
  it("renders the format select with five options", () => {
    render(
      <VideoExtractAudioOptionsPanel
        value={defaultVideoExtractAudioOptions}
        onChange={() => {}}
        file={undefined}
      />,
    );
    const opts = Array.from(
      screen.getByTestId("video-extract-audio-format").querySelectorAll("option"),
    ).map((o) => o.value);
    expect(opts).toEqual(["same", "mp3", "wav", "m4a", "flac"]);
  });

  it('hides the bitrate select for "same" / "wav" / "flac" and shows it for "mp3" / "m4a"', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <VideoExtractAudioOptionsPanel
        value={defaultVideoExtractAudioOptions}
        onChange={onChange}
        file={undefined}
      />,
    );
    expect(screen.queryByTestId("video-extract-audio-bitrate")).toBeNull();

    rerender(
      <VideoExtractAudioOptionsPanel
        value={{ ...defaultVideoExtractAudioOptions, outputFormat: "mp3" }}
        onChange={onChange}
        file={undefined}
      />,
    );
    expect(screen.getByTestId("video-extract-audio-bitrate")).toBeInTheDocument();

    rerender(
      <VideoExtractAudioOptionsPanel
        value={{ ...defaultVideoExtractAudioOptions, outputFormat: "wav" }}
        onChange={onChange}
        file={undefined}
      />,
    );
    expect(screen.queryByTestId("video-extract-audio-bitrate")).toBeNull();

    rerender(
      <VideoExtractAudioOptionsPanel
        value={{ ...defaultVideoExtractAudioOptions, outputFormat: "m4a" }}
        onChange={onChange}
        file={undefined}
      />,
    );
    expect(screen.getByTestId("video-extract-audio-bitrate")).toBeInTheDocument();

    rerender(
      <VideoExtractAudioOptionsPanel
        value={{ ...defaultVideoExtractAudioOptions, outputFormat: "flac" }}
        onChange={onChange}
        file={undefined}
      />,
    );
    expect(screen.queryByTestId("video-extract-audio-bitrate")).toBeNull();
  });

  it("shows the no-audio banner and disables selects when probe reports hasAudio=false", async () => {
    runProbeMock.mockResolvedValueOnce({ hasAudio: false });
    const file = new File([new Uint8Array([1])], "x.mp4", { type: "video/mp4" });
    render(
      <VideoExtractAudioOptionsPanel
        value={{ ...defaultVideoExtractAudioOptions, outputFormat: "mp3" }}
        onChange={() => {}}
        file={file}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("video-extract-audio-no-audio-banner")).toBeInTheDocument();
    });
    const formatSelect = screen.getByTestId("video-extract-audio-format") as HTMLSelectElement;
    expect(formatSelect.disabled).toBe(true);
  });
});
