// src/engines/xml-to-json/options-panel.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { XmlToJsonOptionsPanel } from "./options-panel";

describe("XmlToJsonOptionsPanel", () => {
  it("renders three prefix radios", () => {
    render(<XmlToJsonOptionsPanel value={{ attributePrefix: "@" }} onChange={() => {}} />);
    expect(screen.getByLabelText(/@ \(default\)/)).toBeInTheDocument();
    expect(screen.getByLabelText("$_")).toBeInTheDocument();
    expect(screen.getByLabelText(/none/)).toBeInTheDocument();
  });

  it("emits onChange when toggling prefix", () => {
    const onChange = vi.fn();
    render(<XmlToJsonOptionsPanel value={{ attributePrefix: "@" }} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("$_"));
    expect(onChange).toHaveBeenCalledWith({ attributePrefix: "$_" });
  });
});
