import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultMarkdownToPdfOptions } from "./options";
import { MarkdownToPdfOptionsPanel } from "./options-panel";

describe("MarkdownToPdfOptionsPanel", () => {
  it("renders with letter as default", () => {
    render(<MarkdownToPdfOptionsPanel value={defaultMarkdownToPdfOptions} onChange={() => {}} />);
    expect(screen.getByTestId("page-size")).toHaveValue("letter");
  });

  it("calls onChange when page size changes", () => {
    const onChange = vi.fn();
    render(<MarkdownToPdfOptionsPanel value={defaultMarkdownToPdfOptions} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("page-size"), {
      target: { value: "a4" },
    });
    expect(onChange).toHaveBeenCalledWith({ pageSize: "a4" });
  });

  it("offers all three page sizes", () => {
    render(<MarkdownToPdfOptionsPanel value={defaultMarkdownToPdfOptions} onChange={() => {}} />);
    const select = screen.getByTestId("page-size");
    const options = Array.from(select.querySelectorAll("option")).map((o) =>
      o.getAttribute("value"),
    );
    expect(options).toEqual(["letter", "a4", "legal"]);
  });
});
