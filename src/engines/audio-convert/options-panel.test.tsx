import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultAudioConvertOptions } from "./options";
import { AudioConvertOptionsPanel } from "./options-panel";

describe("AudioConvertOptionsPanel", () => {
  it("renders four format options", () => {
    const onChange = vi.fn();
    render(
      <AudioConvertOptionsPanel
        value={defaultAudioConvertOptions}
        onChange={onChange}
      />,
    );
    for (const fmt of ["mp3", "wav", "m4a", "flac"]) {
      expect(screen.getByText(fmt, { exact: false })).toBeInTheDocument();
    }
  });

  it("hides the bitrate dropdown when format is lossless (wav)", () => {
    const onChange = vi.fn();
    render(
      <AudioConvertOptionsPanel
        value={{ ...defaultAudioConvertOptions, outputFormat: "wav" }}
        onChange={onChange}
      />,
    );
    expect(screen.queryByLabelText(/bitrate/i)).not.toBeInTheDocument();
  });

  it("shows the bitrate dropdown when format is lossy (mp3)", () => {
    const onChange = vi.fn();
    render(
      <AudioConvertOptionsPanel
        value={{ ...defaultAudioConvertOptions, outputFormat: "mp3" }}
        onChange={onChange}
      />,
    );
    expect(screen.getByLabelText(/bitrate/i)).toBeInTheDocument();
  });

  it("calls onChange with new outputFormat when a format radio is selected", () => {
    const onChange = vi.fn();
    render(
      <AudioConvertOptionsPanel
        value={defaultAudioConvertOptions}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText(/mp3/i));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ outputFormat: "mp3" }),
    );
  });
});
