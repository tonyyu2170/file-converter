import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultPdfToImageOptions } from "./options";
import { PdfToImageOptionsPanel } from "./options-panel";

describe("PdfToImageOptionsPanel", () => {
  it("renders all controls with default values; quality slider hidden for PNG", () => {
    render(<PdfToImageOptionsPanel value={defaultPdfToImageOptions} onChange={() => undefined} />);
    expect(screen.getByTestId("pdf-to-image-format")).toBeInTheDocument();
    const png = screen.getByDisplayValue("png") as HTMLInputElement;
    const jpeg = screen.getByDisplayValue("jpeg") as HTMLInputElement;
    expect(png.checked).toBe(true);
    expect(jpeg.checked).toBe(false);
    const scale = screen.getByTestId("pdf-to-image-scale") as HTMLSelectElement;
    expect(scale.value).toBe("2");
    const range = screen.getByTestId("range-input") as HTMLInputElement;
    expect(range.value).toBe("");
    expect(screen.queryByTestId("pdf-to-image-quality")).not.toBeInTheDocument();
  });

  it("reveals the JPEG quality slider when format switches to JPEG and hides it on switch back", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <PdfToImageOptionsPanel value={defaultPdfToImageOptions} onChange={onChange} />,
    );
    expect(screen.queryByTestId("pdf-to-image-quality")).not.toBeInTheDocument();
    rerender(
      <PdfToImageOptionsPanel
        value={{ ...defaultPdfToImageOptions, format: "jpeg" }}
        onChange={onChange}
      />,
    );
    const quality = screen.getByTestId("pdf-to-image-quality") as HTMLInputElement;
    expect(quality).toBeInTheDocument();
    expect(quality.value).toBe("90");
    rerender(<PdfToImageOptionsPanel value={defaultPdfToImageOptions} onChange={onChange} />);
    expect(screen.queryByTestId("pdf-to-image-quality")).not.toBeInTheDocument();
  });

  it("shows inline syntax error for malformed range input", () => {
    render(
      <PdfToImageOptionsPanel
        value={{ ...defaultPdfToImageOptions, rangeInput: "abc" }}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByTestId("range-syntax-error")).toBeInTheDocument();
  });

  it("hides the syntax error when range input is empty", () => {
    render(<PdfToImageOptionsPanel value={defaultPdfToImageOptions} onChange={() => undefined} />);
    expect(screen.queryByTestId("range-syntax-error")).not.toBeInTheDocument();
  });

  it("propagates updated options via onChange when format/scale/quality/range change", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <PdfToImageOptionsPanel value={defaultPdfToImageOptions} onChange={onChange} />,
    );
    fireEvent.click(screen.getByDisplayValue("jpeg"));
    expect(onChange).toHaveBeenLastCalledWith({ ...defaultPdfToImageOptions, format: "jpeg" });

    fireEvent.change(screen.getByTestId("pdf-to-image-scale"), { target: { value: "3" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...defaultPdfToImageOptions, scale: 3 });

    fireEvent.change(screen.getByTestId("range-input"), { target: { value: "1-3" } });
    expect(onChange).toHaveBeenLastCalledWith({
      ...defaultPdfToImageOptions,
      rangeInput: "1-3",
    });

    rerender(
      <PdfToImageOptionsPanel
        value={{ ...defaultPdfToImageOptions, format: "jpeg" }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByTestId("pdf-to-image-quality"), { target: { value: "55" } });
    expect(onChange).toHaveBeenLastCalledWith({
      ...defaultPdfToImageOptions,
      format: "jpeg",
      jpegQuality: 55,
    });
  });
});
