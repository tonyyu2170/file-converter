import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultArchiveCreateOptions } from "./options";
import { ArchiveCreateStagingArea } from "./staging-area";

function makeFile(name: string): File {
  return new File(["x"], name, { type: "text/plain" });
}

describe("ArchiveCreateStagingArea", () => {
  it("renders one row per file in order", () => {
    render(
      <ArchiveCreateStagingArea
        files={[makeFile("a.txt"), makeFile("b.txt")]}
        onChange={() => {}}
        options={defaultArchiveCreateOptions}
        setOptions={() => {}}
      />,
    );
    const rows = screen.getAllByTestId("staging-row");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("a.txt"),
      expect.stringContaining("b.txt"),
    ]);
  });

  it("× removes a file", () => {
    const onChange = vi.fn();
    const files = [makeFile("a.txt"), makeFile("b.txt")];
    render(
      <ArchiveCreateStagingArea
        files={files}
        onChange={onChange}
        options={defaultArchiveCreateOptions}
        setOptions={() => {}}
      />,
    );
    const [removeFirst] = screen.getAllByTestId("remove");
    if (!removeFirst) throw new Error("expected at least 1 remove button");
    fireEvent.click(removeFirst);
    expect(onChange).toHaveBeenCalledWith([files[1]]);
  });

  it("↑ moves a row up", () => {
    const onChange = vi.fn();
    const files = [makeFile("a.txt"), makeFile("b.txt")];
    render(
      <ArchiveCreateStagingArea
        files={files}
        onChange={onChange}
        options={defaultArchiveCreateOptions}
        setOptions={() => {}}
      />,
    );
    const ups = screen.getAllByTestId("move-up");
    const [firstUp, secondUp] = ups;
    if (!firstUp || !secondUp) throw new Error("expected at least 2 move-up buttons");
    expect(firstUp).toBeDisabled();
    fireEvent.click(secondUp);
    expect(onChange).toHaveBeenCalledWith([files[1], files[0]]);
  });
});
