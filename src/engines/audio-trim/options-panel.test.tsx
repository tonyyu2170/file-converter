import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultAudioTrimOptions } from "./options";
import { AudioTrimOptionsPanel } from "./options-panel";

const fakeFile = new File([new Uint8Array([0])], "song.mp3", { type: "audio/mpeg" });

vi.mock("@/engines/_shared/trim-scrubber/duration", () => ({
  readMediaDurationSec: vi.fn().mockResolvedValue(30),
}));

vi.mock("./index", async () => {
  // Mock the harness accessor used by the panel so tests don't spin up a real worker.
  return {
    getAudioTrimHarness: () => ({
      runDecodePeaks: vi.fn().mockResolvedValue({
        min: new Float32Array(512),
        max: new Float32Array(512),
      }),
    }),
  };
});

describe("AudioTrimOptionsPanel", () => {
  it("renders the format dropdown with 'same' as default", () => {
    render(
      <AudioTrimOptionsPanel value={defaultAudioTrimOptions} onChange={() => {}} file={fakeFile} />,
    );
    const select = screen.getByLabelText(/output format/i) as HTMLSelectElement;
    expect(select.value).toBe("same");
  });

  it("hides the bitrate dropdown when format is 'same'", () => {
    render(
      <AudioTrimOptionsPanel value={defaultAudioTrimOptions} onChange={() => {}} file={fakeFile} />,
    );
    expect(screen.queryByLabelText(/bitrate/i)).not.toBeInTheDocument();
  });

  it("hides the bitrate dropdown when format is wav (lossless)", () => {
    render(
      <AudioTrimOptionsPanel
        value={{ ...defaultAudioTrimOptions, outputFormat: "wav" }}
        onChange={() => {}}
        file={fakeFile}
      />,
    );
    expect(screen.queryByLabelText(/bitrate/i)).not.toBeInTheDocument();
  });

  it("shows the bitrate dropdown when format is mp3 (lossy)", () => {
    render(
      <AudioTrimOptionsPanel
        value={{ ...defaultAudioTrimOptions, outputFormat: "mp3" }}
        onChange={() => {}}
        file={fakeFile}
      />,
    );
    expect(screen.getByLabelText(/bitrate/i)).toBeInTheDocument();
  });

  it("calls onChange with new format when user picks one", () => {
    const onChange = vi.fn();
    render(
      <AudioTrimOptionsPanel value={defaultAudioTrimOptions} onChange={onChange} file={fakeFile} />,
    );
    const select = screen.getByLabelText(/output format/i);
    fireEvent.change(select, { target: { value: "mp3" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ outputFormat: "mp3" }));
  });

  it("on file stage, probes duration and writes endSec back into options", async () => {
    const onChange = vi.fn();
    render(
      <AudioTrimOptionsPanel value={defaultAudioTrimOptions} onChange={onChange} file={fakeFile} />,
    );
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ startSec: 0, endSec: 30 }));
    });
  });

  it("renders nothing waveform-related when no file is staged", () => {
    render(
      <AudioTrimOptionsPanel
        value={defaultAudioTrimOptions}
        onChange={() => {}}
        file={undefined}
      />,
    );
    expect(screen.queryByTestId("trim-scrubber")).not.toBeInTheDocument();
  });

  it("renders the TrimScrubber when a file is staged and duration is known", async () => {
    render(
      <AudioTrimOptionsPanel value={defaultAudioTrimOptions} onChange={() => {}} file={fakeFile} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("trim-scrubber")).toBeInTheDocument();
    });
  });
});
