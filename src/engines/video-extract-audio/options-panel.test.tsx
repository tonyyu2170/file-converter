// src/engines/video-extract-audio/options-panel.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultVideoExtractAudioOptions } from "./options";
import { VideoExtractAudioOptionsPanel } from "./options-panel";

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
});
