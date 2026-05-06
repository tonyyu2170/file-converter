import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TrimScrubber } from "./index";

const fakeFile = new File([new Uint8Array([0])], "x.mp3", { type: "audio/mpeg" });

describe("TrimScrubber (audio)", () => {
  it("renders mm:ss.ms labels for start and end positions", () => {
    render(
      <TrimScrubber
        source={fakeFile}
        modality="audio"
        durationSec={75.5}
        startSec={10}
        endSec={70}
        onChange={() => {}}
      />,
    );
    // Start handle label: 10s → "00:10.000"
    expect(screen.getByText("00:10.000")).toBeInTheDocument();
    // End handle label: 70s → "01:10.000"
    expect(screen.getByText("01:10.000")).toBeInTheDocument();
  });

  it("renders two interactive handles with role=slider and accessible labels", () => {
    render(
      <TrimScrubber
        source={fakeFile}
        modality="audio"
        durationSec={60}
        startSec={5}
        endSec={55}
        onChange={() => {}}
      />,
    );
    const start = screen.getByRole("slider", { name: /trim start/i });
    const end = screen.getByRole("slider", { name: /trim end/i });
    expect(start).toBeInTheDocument();
    expect(end).toBeInTheDocument();
    expect(start.getAttribute("aria-valuenow")).toBe("5");
    expect(end.getAttribute("aria-valuenow")).toBe("55");
    expect(start.getAttribute("aria-valuemin")).toBe("0");
    expect(start.getAttribute("aria-valuemax")).toBe("60");
    expect(start.getAttribute("aria-valuetext")).toBe("00:05.000");
    expect(end.getAttribute("aria-valuetext")).toBe("00:55.000");
  });

  it("ArrowRight on the start handle moves start forward by 1 s", () => {
    const onChange = vi.fn();
    render(
      <TrimScrubber
        source={fakeFile}
        modality="audio"
        durationSec={60}
        startSec={5}
        endSec={55}
        onChange={onChange}
      />,
    );
    const start = screen.getByRole("slider", { name: /trim start/i });
    fireEvent.keyDown(start, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith(6, 55);
  });

  it("Shift+ArrowRight on the end handle moves end forward by 10 s, clamped to duration", () => {
    const onChange = vi.fn();
    render(
      <TrimScrubber
        source={fakeFile}
        modality="audio"
        durationSec={60}
        startSec={5}
        endSec={55}
        onChange={onChange}
      />,
    );
    const end = screen.getByRole("slider", { name: /trim end/i });
    fireEvent.keyDown(end, { key: "ArrowRight", shiftKey: true });
    expect(onChange).toHaveBeenCalledWith(5, 60); // clamped to durationSec
  });

  it("ArrowLeft on the start handle stops at 0", () => {
    const onChange = vi.fn();
    render(
      <TrimScrubber
        source={fakeFile}
        modality="audio"
        durationSec={60}
        startSec={0.5}
        endSec={55}
        onChange={onChange}
      />,
    );
    const start = screen.getByRole("slider", { name: /trim start/i });
    fireEvent.keyDown(start, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith(0, 55);
  });

  it("start handle cannot be moved past end handle (clamped to endSec)", () => {
    const onChange = vi.fn();
    render(
      <TrimScrubber
        source={fakeFile}
        modality="audio"
        durationSec={60}
        startSec={54.5}
        endSec={55}
        onChange={onChange}
      />,
    );
    const start = screen.getByRole("slider", { name: /trim start/i });
    fireEvent.keyDown(start, { key: "ArrowRight" });
    // Would land at 55.5, which exceeds endSec; clamp to endSec.
    expect(onChange).toHaveBeenCalledWith(55, 55);
  });

  it("does not call onChange when disabled", () => {
    const onChange = vi.fn();
    render(
      <TrimScrubber
        source={fakeFile}
        modality="audio"
        durationSec={60}
        startSec={5}
        endSec={55}
        onChange={onChange}
        disabled
      />,
    );
    const start = screen.getByRole("slider", { name: /trim start/i });
    fireEvent.keyDown(start, { key: "ArrowRight" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("throws synchronously for the video modality (deferred to phase 22)", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(
        <TrimScrubber
          source={fakeFile}
          modality="video"
          durationSec={60}
          startSec={0}
          endSec={60}
          onChange={() => {}}
        />,
      ),
    ).toThrow(/video.*phase 22/i);
    consoleSpy.mockRestore();
  });
});
