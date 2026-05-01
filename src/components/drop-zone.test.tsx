import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DropZone } from "./drop-zone";

describe("DropZone", () => {
  it("renders the default prompt and hint", () => {
    render(<DropZone onFiles={() => undefined} />);
    expect(screen.getByText("drop a file")).toBeInTheDocument();
    expect(screen.getByText("or click to browse")).toBeInTheDocument();
  });

  it("calls onFiles with dropped files", () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} />);
    const file = new File(["x"], "a.heic", { type: "image/heic" });
    fireEvent.drop(screen.getByTestId("drop-zone"), {
      dataTransfer: { files: [file] },
    });
    expect(onFiles).toHaveBeenCalledWith([file]);
  });

  it("toggles data-state to 'over' on dragover", () => {
    render(<DropZone onFiles={() => undefined} />);
    const zone = screen.getByTestId("drop-zone");
    fireEvent.dragOver(zone);
    expect(zone).toHaveAttribute("data-state", "over");
    fireEvent.dragLeave(zone);
    expect(zone).toHaveAttribute("data-state", "idle");
  });
});
