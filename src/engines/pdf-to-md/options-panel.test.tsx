import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultPdfToMdOptions } from "./options";
import { PdfToMdOptionsPanel } from "./options-panel";

describe("PdfToMdOptionsPanel", () => {
  it("renders both radio options with horizontal-rule selected by default", () => {
    render(<PdfToMdOptionsPanel value={defaultPdfToMdOptions} onChange={() => undefined} />);
    const fieldset = screen.getByTestId("pdf-to-md-page-breaks");
    const hr = within(fieldset).getByRole("radio", {
      name: /horizontal rule/i,
    }) as HTMLInputElement;
    const none = within(fieldset).getByRole("radio", { name: /none/i }) as HTMLInputElement;
    expect(hr.checked).toBe(true);
    expect(none.checked).toBe(false);
  });

  it("renders with 'none' selected when value.pageBreaks is 'none'", () => {
    render(<PdfToMdOptionsPanel value={{ pageBreaks: "none" }} onChange={() => undefined} />);
    const fieldset = screen.getByTestId("pdf-to-md-page-breaks");
    const hr = within(fieldset).getByRole("radio", {
      name: /horizontal rule/i,
    }) as HTMLInputElement;
    const none = within(fieldset).getByRole("radio", { name: /none/i }) as HTMLInputElement;
    expect(hr.checked).toBe(false);
    expect(none.checked).toBe(true);
  });

  it("calls onChange with pageBreaks: 'none' when selecting the none radio", () => {
    const onChange = vi.fn();
    render(<PdfToMdOptionsPanel value={defaultPdfToMdOptions} onChange={onChange} />);
    const fieldset = screen.getByTestId("pdf-to-md-page-breaks");
    fireEvent.click(within(fieldset).getByRole("radio", { name: /none/i }));
    expect(onChange).toHaveBeenCalledWith({ pageBreaks: "none" });
  });

  it("calls onChange with pageBreaks: 'horizontal-rule' when selecting that radio", () => {
    const onChange = vi.fn();
    render(<PdfToMdOptionsPanel value={{ pageBreaks: "none" }} onChange={onChange} />);
    const fieldset = screen.getByTestId("pdf-to-md-page-breaks");
    fireEvent.click(within(fieldset).getByRole("radio", { name: /horizontal rule/i }));
    expect(onChange).toHaveBeenCalledWith({ pageBreaks: "horizontal-rule" });
  });

  it("renders the limitations disclosure text", () => {
    render(<PdfToMdOptionsPanel value={defaultPdfToMdOptions} onChange={() => undefined} />);
    const note = screen.getByTestId("pdf-to-md-limitations");
    expect(note).toBeInTheDocument();
    expect(note.textContent).toMatch(/best-effort heuristic/i);
    expect(note.textContent).toMatch(/multi-column/i);
  });
});
