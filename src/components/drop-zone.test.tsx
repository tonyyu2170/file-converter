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

  it("renders muted state when disabled", () => {
    render(<DropZone onFiles={() => undefined} disabled />);
    expect(screen.getByTestId("drop-zone")).toHaveAttribute("data-state", "disabled");
  });

  it("does not call onFiles when a drop occurs while disabled", () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} disabled />);
    const file = new File(["x"], "a.heic", { type: "image/heic" });
    fireEvent.drop(screen.getByTestId("drop-zone"), {
      dataTransfer: { files: [file] },
    });
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("does not toggle data-state to 'over' on dragover while disabled", () => {
    render(<DropZone onFiles={() => undefined} disabled />);
    const zone = screen.getByTestId("drop-zone");
    fireEvent.dragOver(zone);
    expect(zone).toHaveAttribute("data-state", "disabled");
  });
});
