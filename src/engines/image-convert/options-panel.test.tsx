import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultImageConvertOptions } from "./options";
import { ImageConvertOptionsPanel } from "./options-panel";

describe("ImageConvertOptionsPanel", () => {
  it("renders the placeholder option in the select", () => {
    render(
      <ImageConvertOptionsPanel value={defaultImageConvertOptions} onChange={() => undefined} />,
    );
    expect(screen.getByTestId("output-format")).toHaveValue("");
  });

  it("hides the quality slider when no output format is selected", () => {
    render(
      <ImageConvertOptionsPanel value={defaultImageConvertOptions} onChange={() => undefined} />,
    );
    expect(screen.queryByTestId("quality-slider")).toBeNull();
  });

  it("hides the quality slider when output format is PNG", () => {
    render(
      <ImageConvertOptionsPanel
        value={{ output: "png", quality: 0.9 }}
        onChange={() => undefined}
      />,
    );
    expect(screen.queryByTestId("quality-slider")).toBeNull();
  });

  it("shows the quality slider when output format is JPEG", () => {
    render(
      <ImageConvertOptionsPanel
        value={{ output: "jpeg", quality: 0.9 }}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByTestId("quality-slider")).toBeInTheDocument();
    expect(screen.getByTestId("quality-value")).toHaveTextContent("0.90");
  });

  it("calls onChange with the new output format when select changes", () => {
    const onChange = vi.fn();
    render(<ImageConvertOptionsPanel value={defaultImageConvertOptions} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("output-format"), { target: { value: "jpeg" } });
    expect(onChange).toHaveBeenCalledWith({ output: "jpeg", quality: 0.9 });
  });

  it("calls onChange with the new quality when slider changes", () => {
    const onChange = vi.fn();
    render(
      <ImageConvertOptionsPanel value={{ output: "jpeg", quality: 0.9 }} onChange={onChange} />,
    );
    fireEvent.change(screen.getByTestId("quality-slider"), { target: { value: "0.5" } });
    expect(onChange).toHaveBeenCalledWith({ output: "jpeg", quality: 0.5 });
  });

  it("clears output format back to null when the placeholder is re-selected", () => {
    const onChange = vi.fn();
    render(
      <ImageConvertOptionsPanel value={{ output: "jpeg", quality: 0.9 }} onChange={onChange} />,
    );
    fireEvent.change(screen.getByTestId("output-format"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith({ output: null, quality: 0.9 });
  });
});
