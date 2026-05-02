import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultPdfSplitOptions } from "./options";
import { PdfSplitOptionsPanel } from "./options-panel";

describe("PdfSplitOptionsPanel", () => {
  it("renders the range input with empty default", () => {
    render(<PdfSplitOptionsPanel value={defaultPdfSplitOptions} onChange={() => undefined} />);
    const input = screen.getByTestId("range-input") as HTMLInputElement;
    expect(input.value).toBe("");
  });

  it("calls onChange when the user types", () => {
    const onChange = vi.fn();
    render(<PdfSplitOptionsPanel value={defaultPdfSplitOptions} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("range-input"), { target: { value: "1-3" } });
    expect(onChange).toHaveBeenCalledWith({ rangeInput: "1-3" });
  });

  it("hides the syntax error when input is empty", () => {
    render(<PdfSplitOptionsPanel value={defaultPdfSplitOptions} onChange={() => undefined} />);
    expect(screen.queryByTestId("range-syntax-error")).not.toBeInTheDocument();
  });

  it("shows inline syntax error for malformed token", () => {
    render(<PdfSplitOptionsPanel value={{ rangeInput: "1, abc, 3" }} onChange={() => undefined} />);
    const err = screen.getByTestId("range-syntax-error");
    expect(err).toBeInTheDocument();
    expect(err.textContent).toMatch(/can't parse/);
  });

  it("shows inline syntax error for trailing comma", () => {
    render(<PdfSplitOptionsPanel value={{ rangeInput: "1-3," }} onChange={() => undefined} />);
    expect(screen.getByTestId("range-syntax-error").textContent).toMatch(/trailing/);
  });

  it("does NOT show 'exceeds N' for valid syntax (deferred to worker)", () => {
    // rangeInput "9999999" is syntactically valid; the panel uses
    // MAX_SAFE_INTEGER pageCount so this never trips OOB.
    render(<PdfSplitOptionsPanel value={{ rangeInput: "9999999" }} onChange={() => undefined} />);
    expect(screen.queryByTestId("range-syntax-error")).not.toBeInTheDocument();
  });
});
