import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultImageBgRemoveOptions } from "./options";
import { ImageBgRemoveOptionsPanel } from "./options-panel";

function renderPanel(initial = defaultImageBgRemoveOptions) {
  const onChange = vi.fn();
  let value = initial;
  const rerender = (next: typeof initial) => {
    value = next;
  };
  const utils = render(
    <ImageBgRemoveOptionsPanel
      value={value}
      onChange={(n) => {
        onChange(n);
        rerender(n);
      }}
    />,
  );
  return { ...utils, onChange, getValue: () => value };
}

describe("ImageBgRemoveOptionsPanel", () => {
  it("renders with default state — quality slider hidden, transparent active", () => {
    renderPanel();
    expect(screen.queryByTestId("quality-slider")).toBeNull();
    expect(screen.getByTestId("bg-mode-transparent")).toHaveClass(/bg-/);
  });

  it("clicking 'solid' switches mode without changing color", () => {
    const { onChange } = renderPanel();
    fireEvent.click(screen.getByTestId("bg-mode-solid"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ bgMode: "solid", bgColor: "#ffffff" }),
    );
  });

  it("white preset sets bgMode=solid + bgColor=#ffffff", () => {
    const { onChange } = renderPanel();
    fireEvent.click(screen.getByTestId("preset-white"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ bgMode: "solid", bgColor: "#ffffff" }),
    );
  });

  it("transparent preset is disabled when outputFormat=jpeg", () => {
    renderPanel({ ...defaultImageBgRemoveOptions, bgMode: "solid", outputFormat: "jpeg" });
    expect(screen.getByTestId("preset-transparent")).toBeDisabled();
  });

  it("quality slider appears only when outputFormat=jpeg", () => {
    renderPanel({ ...defaultImageBgRemoveOptions, bgMode: "solid", outputFormat: "jpeg" });
    expect(screen.getByTestId("quality-slider")).toBeInTheDocument();
  });

  it("hex text input reverts on invalid blur", () => {
    const { onChange } = renderPanel({ ...defaultImageBgRemoveOptions, bgMode: "solid" });
    const hex = screen.getByTestId("custom-hex");
    fireEvent.change(hex, { target: { value: "garbage" } });
    fireEvent.blur(hex);
    // onChange should NOT have been called with the bad value
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ bgColor: "garbage" }));
  });

  it("clicking PNG when in solid+jpeg switches output without losing color", () => {
    const { onChange } = renderPanel({
      ...defaultImageBgRemoveOptions,
      bgMode: "solid",
      bgColor: "#abcdef",
      outputFormat: "jpeg",
    });
    fireEvent.click(screen.getByTestId("output-png"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ outputFormat: "png", bgColor: "#abcdef" }),
    );
  });
});
