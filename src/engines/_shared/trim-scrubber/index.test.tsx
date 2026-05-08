import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
});

describe('TrimScrubber modality:"video"', () => {
  // Save/restore getBoundingClientRect to prevent leaks between tests.
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
  afterEach(() => {
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  it("renders a skeleton placeholder when no extractFrames is provided", () => {
    const file = new File([new Uint8Array([1])], "x.mp4", { type: "video/mp4" });
    render(
      <TrimScrubber
        source={file}
        modality="video"
        durationSec={5}
        startSec={0}
        endSec={5}
        onChange={() => {}}
      />,
    );
    const strip = screen.getByTestId("trim-scrubber-frame-strip");
    expect(strip).toBeInTheDocument();
    // Skeleton has no <img> children.
    expect(strip.querySelectorAll("img").length).toBe(0);
  });

  it("renders the returned strip thumbnails as <img> elements", async () => {
    const file = new File([new Uint8Array([1])], "x.mp4", { type: "video/mp4" });
    const extractFrames = vi.fn().mockResolvedValue({
      urls: ["blob:fake-1", "blob:fake-2", "blob:fake-3"],
      widthPx: 107,
    });
    // jsdom's getBoundingClientRect returns 0 by default; stub a non-zero
    // width so the count formula doesn't bail out.
    Element.prototype.getBoundingClientRect = vi.fn(
      () => ({ width: 800, height: 60, top: 0, left: 0, bottom: 60, right: 800 }) as DOMRect,
    );

    render(
      <TrimScrubber
        source={file}
        modality="video"
        durationSec={5}
        startSec={0}
        endSec={5}
        onChange={() => {}}
        extractFrames={extractFrames}
      />,
    );

    await waitFor(() => {
      const imgs = screen.getByTestId("trim-scrubber-frame-strip").querySelectorAll("img");
      expect(imgs.length).toBe(3);
    });
    // 800px container / 80px slot = 10 frames requested.
    expect(extractFrames).toHaveBeenCalledWith(file, 10, 60);
  });

  it("revokes object URLs on unmount", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const file = new File([new Uint8Array([1])], "x.mp4", { type: "video/mp4" });
    const extractFrames = vi.fn().mockResolvedValue({
      urls: ["blob:fake-1", "blob:fake-2"],
      widthPx: 107,
    });
    Element.prototype.getBoundingClientRect = vi.fn(
      () => ({ width: 800, height: 60, top: 0, left: 0, bottom: 60, right: 800 }) as DOMRect,
    );

    const { unmount } = render(
      <TrimScrubber
        source={file}
        modality="video"
        durationSec={5}
        startSec={0}
        endSec={5}
        onChange={() => {}}
        extractFrames={extractFrames}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("trim-scrubber-frame-strip").querySelectorAll("img").length).toBe(
        2,
      );
    });

    unmount();
    expect(revoke).toHaveBeenCalledWith("blob:fake-1");
    expect(revoke).toHaveBeenCalledWith("blob:fake-2");
    revoke.mockRestore();
  });

  it("revokes object URLs when extractFrames resolves after unmount", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const file = new File([new Uint8Array([1])], "x.mp4", { type: "video/mp4" });
    let resolveExtract!: (v: { urls: string[]; widthPx: number }) => void;
    const extractFrames = vi.fn(
      () =>
        new Promise<{ urls: string[]; widthPx: number }>((r) => {
          resolveExtract = r;
        }),
    );
    Element.prototype.getBoundingClientRect = vi.fn(
      () => ({ width: 800, height: 60, top: 0, left: 0, bottom: 60, right: 800 }) as DOMRect,
    );

    const { unmount } = render(
      <TrimScrubber
        source={file}
        modality="video"
        durationSec={5}
        startSec={0}
        endSec={5}
        onChange={() => {}}
        extractFrames={extractFrames}
      />,
    );

    // Unmount BEFORE extractFrames resolves.
    unmount();
    // Now resolve. The cancellation branch should revoke each URL.
    await act(async () => {
      resolveExtract({ urls: ["blob:late-1", "blob:late-2"], widthPx: 107 });
      // Flush microtasks so the .then handler runs.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(revoke).toHaveBeenCalledWith("blob:late-1");
    expect(revoke).toHaveBeenCalledWith("blob:late-2");
    revoke.mockRestore();
  });

  it("keeps the skeleton (stripUrls=null) when extractFrames rejects", async () => {
    const file = new File([new Uint8Array([1])], "x.mp4", { type: "video/mp4" });
    const extractFrames = vi.fn().mockRejectedValue(new Error("boom"));
    Element.prototype.getBoundingClientRect = vi.fn(
      () => ({ width: 800, height: 60, top: 0, left: 0, bottom: 60, right: 800 }) as DOMRect,
    );

    render(
      <TrimScrubber
        source={file}
        modality="video"
        durationSec={5}
        startSec={0}
        endSec={5}
        onChange={() => {}}
        extractFrames={extractFrames}
      />,
    );

    // Wait for the rejection branch to settle.
    await waitFor(() => {
      expect(extractFrames).toHaveBeenCalled();
    });
    // Strip remains in skeleton state — zero <img> children.
    const strip = screen.getByTestId("trim-scrubber-frame-strip");
    expect(strip.querySelectorAll("img").length).toBe(0);
  });
});
