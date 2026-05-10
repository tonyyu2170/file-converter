import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VideoConvertOptionsPanel } from "./options-panel";
import { defaultVideoConvertOptions } from "./options";

describe("VideoConvertOptionsPanel", () => {
  it("renders three format radios in design order", () => {
    render(
      <VideoConvertOptionsPanel
        value={defaultVideoConvertOptions}
        onChange={() => undefined}
      />,
    );
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(["mp4", "mov", "webm"]);
  });

  it("emits onChange with the chosen format", () => {
    const onChange = vi.fn();
    render(
      <VideoConvertOptionsPanel
        value={defaultVideoConvertOptions}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText("mp4"));
    expect(onChange).toHaveBeenCalledWith({
      ...defaultVideoConvertOptions,
      outputFormat: "mp4",
    });
  });

  it("renders a quality select with low/medium/high options", () => {
    render(
      <VideoConvertOptionsPanel
        value={{ outputFormat: "mp4", quality: "medium" }}
        onChange={() => undefined}
      />,
    );
    const select = screen.getByLabelText("quality") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "low",
      "medium",
      "high",
    ]);
    expect(select.value).toBe("medium");
  });

  it("emits onChange with the chosen quality", () => {
    const onChange = vi.fn();
    render(
      <VideoConvertOptionsPanel
        value={{ outputFormat: "mp4", quality: "medium" }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("quality"), { target: { value: "high" } });
    expect(onChange).toHaveBeenCalledWith({
      outputFormat: "mp4",
      quality: "high",
    });
  });

  it("renders a tooltip-style hint about expected latency", () => {
    render(
      <VideoConvertOptionsPanel
        value={defaultVideoConvertOptions}
        onChange={() => undefined}
      />,
    );
    expect(
      screen.getByText(/typically takes ~1 minute per minute of video/i),
    ).toBeInTheDocument();
  });
});
