// src/engines/data-convert/options-panel.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DataConvertOptionsPanel } from "./options-panel";

describe("DataConvertOptionsPanel", () => {
  it("renders three format radios", () => {
    render(<DataConvertOptionsPanel value={{ outputFormat: "json" }} onChange={() => {}} />);
    expect(screen.getByLabelText("csv")).toBeInTheDocument();
    expect(screen.getByLabelText("json")).toBeInTheDocument();
    expect(screen.getByLabelText("yaml")).toBeInTheDocument();
  });
  it("emits onChange when format toggles", () => {
    const onChange = vi.fn();
    render(<DataConvertOptionsPanel value={{ outputFormat: "json" }} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("yaml"));
    expect(onChange).toHaveBeenCalledWith({ outputFormat: "yaml" });
  });
});
