import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultTxtToPdfOptions } from "./options";
import { TxtToPdfOptionsPanel } from "./options-panel";

describe("TxtToPdfOptionsPanel", () => {
  it("renders with letter as default", () => {
    render(<TxtToPdfOptionsPanel value={defaultTxtToPdfOptions} onChange={() => {}} />);
    expect(screen.getByTestId("page-size")).toHaveValue("letter");
  });

  it("calls onChange when page size changes", () => {
    const onChange = vi.fn();
    render(<TxtToPdfOptionsPanel value={defaultTxtToPdfOptions} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("page-size"), { target: { value: "legal" } });
    expect(onChange).toHaveBeenCalledWith({ pageSize: "legal" });
  });
});
