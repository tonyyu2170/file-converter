import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultImageToPdfOptions } from "./options";
import { ImageToPdfOptionsPanel } from "./options-panel";

describe("ImageToPdfOptionsPanel", () => {
  it("renders the paper-size select with letter selected by default", () => {
    render(<ImageToPdfOptionsPanel value={defaultImageToPdfOptions} onChange={() => undefined} />);
    expect(screen.getByTestId("paper-size")).toHaveValue("letter");
  });

  it("calls onChange with the new paper size when select changes", () => {
    const onChange = vi.fn();
    render(<ImageToPdfOptionsPanel value={defaultImageToPdfOptions} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("paper-size"), { target: { value: "a4" } });
    expect(onChange).toHaveBeenCalledWith({ paper: "a4" });
  });

  it("renders both letter and a4 options", () => {
    render(<ImageToPdfOptionsPanel value={defaultImageToPdfOptions} onChange={() => undefined} />);
    const select = screen.getByTestId("paper-size") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["letter", "a4"]);
  });
});
