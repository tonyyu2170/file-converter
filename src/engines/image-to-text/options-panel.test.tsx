import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultImageToTextOptions } from "./options";
import { ImageToTextOptionsPanel } from "./options-panel";

describe("ImageToTextOptionsPanel", () => {
  it("renders the output format select with both option values", () => {
    render(
      <ImageToTextOptionsPanel value={defaultImageToTextOptions} onChange={() => undefined} />,
    );
    const select = screen.getByTestId("output-format-select");
    const options = Array.from((select as HTMLSelectElement).options).map((o) => o.value);
    expect(options).toContain("txt");
    expect(options).toContain("json-with-bboxes");
  });

  it("defaults to 'txt' when initial options have outputFormat: 'txt'", () => {
    render(<ImageToTextOptionsPanel value={{ outputFormat: "txt" }} onChange={() => undefined} />);
    expect(screen.getByTestId("output-format-select")).toHaveValue("txt");
  });

  it("calls onChange with full updated options when 'json-with-bboxes' is selected", () => {
    const onChange = vi.fn();
    render(<ImageToTextOptionsPanel value={{ outputFormat: "txt" }} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("output-format-select"), {
      target: { value: "json-with-bboxes" },
    });
    expect(onChange).toHaveBeenCalledWith({ outputFormat: "json-with-bboxes" });
  });

  it("renders the v2-spec tooltip text", () => {
    render(
      <ImageToTextOptionsPanel value={defaultImageToTextOptions} onChange={() => undefined} />,
    );
    expect(
      screen.getByText(/best on scanned documents and screenshots.*lower quality on photos/i),
    ).toBeInTheDocument();
  });
});
