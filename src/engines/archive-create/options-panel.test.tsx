import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultArchiveCreateOptions } from "./options";
import { ArchiveCreateOptionsPanel } from "./options-panel";

describe("ArchiveCreateOptionsPanel", () => {
  it("shows preview with current extension", () => {
    const onChange = vi.fn();
    render(
      <ArchiveCreateOptionsPanel
        value={{ outputFormat: "zip", filename: "myarc" }}
        onChange={onChange}
      />,
    );
    expect(screen.getByTestId("filename-preview").textContent).toContain("myarc.zip");
  });

  it("toggling to tar.gz updates preview extension", () => {
    const onChange = vi.fn();
    render(
      <ArchiveCreateOptionsPanel
        value={{ outputFormat: "zip", filename: "myarc" }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText("tar.gz"));
    expect(onChange).toHaveBeenCalledWith({
      outputFormat: "tar.gz",
      filename: "myarc",
    });
  });

  it("invalid filename surfaces error and aria-invalid", () => {
    const onChange = vi.fn();
    render(
      <ArchiveCreateOptionsPanel
        value={{ outputFormat: "zip", filename: "bad name" }}
        onChange={onChange}
      />,
    );
    expect(screen.getByTestId("filename-input")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByTestId("filename-error")).toBeInTheDocument();
  });

  it("smoke: renders defaults", () => {
    render(<ArchiveCreateOptionsPanel value={defaultArchiveCreateOptions} onChange={() => {}} />);
    expect(screen.getByTestId("archive-create-options")).toBeInTheDocument();
  });
});
