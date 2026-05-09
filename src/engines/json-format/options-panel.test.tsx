// src/engines/json-format/options-panel.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JsonFormatOptionsPanel } from "./options-panel";

describe("JsonFormatOptionsPanel", () => {
  it("shows indent radios in pretty mode", () => {
    render(<JsonFormatOptionsPanel value={{ mode: "pretty", indent: 2 }} onChange={() => {}} />);
    expect(screen.getByLabelText("2")).toBeInTheDocument();
    expect(screen.getByLabelText("4")).toBeInTheDocument();
    expect(screen.getByLabelText("tab")).toBeInTheDocument();
  });

  it("hides indent radios in minify mode", () => {
    render(<JsonFormatOptionsPanel value={{ mode: "minify", indent: 2 }} onChange={() => {}} />);
    expect(screen.queryByLabelText("2")).not.toBeInTheDocument();
  });

  it("emits onChange when toggling mode", () => {
    const onChange = vi.fn();
    render(<JsonFormatOptionsPanel value={{ mode: "pretty", indent: 2 }} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("minify"));
    expect(onChange).toHaveBeenCalledWith({ mode: "minify", indent: 2 });
  });

  it("emits onChange when toggling indent", () => {
    const onChange = vi.fn();
    render(<JsonFormatOptionsPanel value={{ mode: "pretty", indent: 2 }} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("4"));
    expect(onChange).toHaveBeenCalledWith({ mode: "pretty", indent: 4 });
  });
});
