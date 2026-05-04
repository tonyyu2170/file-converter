import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultImageResizeOptions } from "./options";
import { ImageResizeOptionsPanel } from "./options-panel";

describe("ImageResizeOptionsPanel", () => {
  it("renders with default options", () => {
    render(<ImageResizeOptionsPanel value={defaultImageResizeOptions} onChange={() => {}} />);
    expect(screen.getByTestId("resize-mode")).toHaveValue("px");
    expect(screen.getByTestId("resize-width")).toHaveValue(1920);
    expect(screen.getByTestId("resize-height")).toHaveValue(1080);
    expect(screen.getByTestId("resize-lock-ratio")).toBeChecked();
  });

  it("disables height input when lockAspectRatio is on", () => {
    render(<ImageResizeOptionsPanel value={defaultImageResizeOptions} onChange={() => {}} />);
    expect(screen.getByTestId("resize-height")).toBeDisabled();
  });

  it("enables height input when lockAspectRatio is off", () => {
    render(
      <ImageResizeOptionsPanel
        value={{ ...defaultImageResizeOptions, lockAspectRatio: false }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("resize-height")).not.toBeDisabled();
  });

  it("calls onChange when width is edited", () => {
    const onChange = vi.fn();
    render(<ImageResizeOptionsPanel value={defaultImageResizeOptions} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("resize-width"), { target: { value: "800" } });
    expect(onChange).toHaveBeenCalledWith({
      ...defaultImageResizeOptions,
      width: 800,
    });
  });

  it("calls onChange when mode toggles to percent", () => {
    const onChange = vi.fn();
    render(<ImageResizeOptionsPanel value={defaultImageResizeOptions} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("resize-mode"), { target: { value: "percent" } });
    expect(onChange).toHaveBeenCalledWith({
      ...defaultImageResizeOptions,
      mode: "percent",
    });
  });

  it("displays the heic-outputs-png note", () => {
    render(<ImageResizeOptionsPanel value={defaultImageResizeOptions} onChange={() => {}} />);
    expect(screen.getByTestId("resize-heic-note")).toHaveTextContent(/heic outputs png/i);
  });
});
