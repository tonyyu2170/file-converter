import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultImageToPdfOptions } from "./options";

vi.mock("@/engines/_shared/decode-image", () => ({
  decodeImage: vi.fn(async () => {
    throw new Error("stubbed decode failure for tests");
  }),
}));

import { ImageToPdfStagingArea } from "./staging-area";

afterEach(() => vi.clearAllMocks());

function makeFile(name: string, size = 100): File {
  return new File([new Uint8Array(size)], name, { type: "image/png" });
}

describe("ImageToPdfStagingArea", () => {
  it("renders one row per file with page number, name, and size", () => {
    const files = [makeFile("a.png"), makeFile("b.png"), makeFile("c.png")];
    render(
      <ImageToPdfStagingArea
        files={files}
        onChange={() => undefined}
        options={defaultImageToPdfOptions}
        setOptions={() => undefined}
      />,
    );
    expect(screen.getAllByTestId("staging-row")).toHaveLength(3);
    expect(screen.getByText("a.png")).toBeInTheDocument();
    expect(screen.getByText("b.png")).toBeInTheDocument();
    expect(screen.getByText("c.png")).toBeInTheDocument();
  });

  it("disables move-up on the first row and move-down on the last row", () => {
    const files = [makeFile("a.png"), makeFile("b.png"), makeFile("c.png")];
    render(
      <ImageToPdfStagingArea
        files={files}
        onChange={() => undefined}
        options={defaultImageToPdfOptions}
        setOptions={() => undefined}
      />,
    );
    const upButtons = screen.getAllByTestId("move-up");
    const downButtons = screen.getAllByTestId("move-down");
    expect(upButtons[0]).toBeDisabled();
    expect(upButtons[1]).not.toBeDisabled();
    expect(upButtons[2]).not.toBeDisabled();
    expect(downButtons[0]).not.toBeDisabled();
    expect(downButtons[1]).not.toBeDisabled();
    expect(downButtons[2]).toBeDisabled();
  });

  it("move-up swaps with the previous row", () => {
    const files = [makeFile("a.png"), makeFile("b.png"), makeFile("c.png")];
    const onChange = vi.fn();
    render(
      <ImageToPdfStagingArea
        files={files}
        onChange={onChange}
        options={defaultImageToPdfOptions}
        setOptions={() => undefined}
      />,
    );
    const upButtons = screen.getAllByTestId("move-up");
    fireEvent.click(upButtons[1]!);
    expect(onChange).toHaveBeenCalledWith([files[1], files[0], files[2]]);
  });

  it("move-down swaps with the next row", () => {
    const files = [makeFile("a.png"), makeFile("b.png"), makeFile("c.png")];
    const onChange = vi.fn();
    render(
      <ImageToPdfStagingArea
        files={files}
        onChange={onChange}
        options={defaultImageToPdfOptions}
        setOptions={() => undefined}
      />,
    );
    const downButtons = screen.getAllByTestId("move-down");
    fireEvent.click(downButtons[0]!);
    expect(onChange).toHaveBeenCalledWith([files[1], files[0], files[2]]);
  });

  it("remove drops the row from the list", () => {
    const files = [makeFile("a.png"), makeFile("b.png"), makeFile("c.png")];
    const onChange = vi.fn();
    render(
      <ImageToPdfStagingArea
        files={files}
        onChange={onChange}
        options={defaultImageToPdfOptions}
        setOptions={() => undefined}
      />,
    );
    const removes = screen.getAllByTestId("remove");
    fireEvent.click(removes[1]!);
    expect(onChange).toHaveBeenCalledWith([files[0], files[2]]);
  });

  it("falls back to ? placeholder when thumbnail decode fails", async () => {
    const files = [makeFile("a.png")];
    render(
      <ImageToPdfStagingArea
        files={files}
        onChange={() => undefined}
        options={defaultImageToPdfOptions}
        setOptions={() => undefined}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("?")).toBeInTheDocument();
    });
  });

  it("commits decode result under React Strict Mode (no double-mount cancellation)", async () => {
    const files = [makeFile("a.png")];
    render(
      <StrictMode>
        <ImageToPdfStagingArea
          files={files}
          onChange={() => undefined}
          options={defaultImageToPdfOptions}
          setOptions={() => undefined}
        />
      </StrictMode>,
    );
    await waitFor(() => {
      expect(screen.getByText("?")).toBeInTheDocument();
    });
  });

  it("renders a drag handle for each row", () => {
    const files = [makeFile("a.png"), makeFile("b.png")];
    render(
      <ImageToPdfStagingArea
        files={files}
        onChange={() => undefined}
        options={defaultImageToPdfOptions}
        setOptions={() => undefined}
      />,
    );
    expect(screen.getAllByTestId("drag-handle")).toHaveLength(2);
  });
});
