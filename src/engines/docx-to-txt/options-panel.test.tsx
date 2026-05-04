import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultDocxToTxtOptions } from "./options";
import { DocxToTxtOptionsPanel } from "./options-panel";

describe("DocxToTxtOptionsPanel", () => {
  it("renders with default option", () => {
    render(<DocxToTxtOptionsPanel value={defaultDocxToTxtOptions} onChange={() => {}} />);
    expect(screen.getByTestId("paragraph-join")).toHaveValue("double-newline");
  });

  it("calls onChange when selection changes", () => {
    const onChange = vi.fn();
    render(<DocxToTxtOptionsPanel value={defaultDocxToTxtOptions} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("paragraph-join"), {
      target: { value: "single-newline" },
    });
    expect(onChange).toHaveBeenCalledWith({ joinParagraphs: "single-newline" });
  });
});
