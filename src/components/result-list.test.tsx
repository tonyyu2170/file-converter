import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/download", () => ({ download: vi.fn() }));
vi.mock("@/engines/_shared/zip", () => ({
  buildZipBlob: vi.fn(async (_items, name) => ({
    filename: name,
    blob: new Blob(["fake-zip"], { type: "application/zip" }),
  })),
}));

import { buildZipBlob } from "@/engines/_shared/zip";
import { download as downloadMock } from "@/lib/download";
import { ResultList } from "./result-list";

afterEach(() => vi.clearAllMocks());

function makeItem(name: string) {
  return {
    filename: name,
    mime: "application/pdf",
    blob: new Blob(["x"], { type: "application/pdf" }),
  };
}

describe("ResultList", () => {
  it("renders nothing when items is empty", () => {
    const { container } = render(<ResultList items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one row per item with a per-file download button", () => {
    const items = [makeItem("a.pdf"), makeItem("b.pdf")];
    render(<ResultList items={items} />);
    expect(screen.getByText("a.pdf")).toBeInTheDocument();
    expect(screen.getByText("b.pdf")).toBeInTheDocument();
    // 2 per-row + 1 download-all
    expect(screen.getAllByLabelText(/^download /)).toHaveLength(3);
  });

  it("invokes download with the item's blob and filename when a per-row button is clicked", () => {
    const item = makeItem("a.pdf");
    render(<ResultList items={[item]} />);
    fireEvent.click(screen.getByLabelText("download a.pdf"));
    expect(downloadMock).toHaveBeenCalledWith(item.blob, item.filename);
  });

  it("hides the download-all button when items.length === 1", () => {
    const items = [makeItem("only.pdf")];
    render(<ResultList items={items} />);
    expect(screen.queryByTestId("download-all-zip")).not.toBeInTheDocument();
  });

  it("shows the download-all button with the file count when items.length > 1", () => {
    const items = [makeItem("a.pdf"), makeItem("b.pdf"), makeItem("c.pdf")];
    render(<ResultList items={items} />);
    const btn = screen.getByTestId("download-all-zip");
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent("[ download all (3) as zip ]");
  });

  it("computes archive name from archiveBasename + archiveSuffix on click", async () => {
    const items = [makeItem("a.pdf"), makeItem("b.pdf")];
    render(<ResultList items={items} archiveBasename="myfile" archiveSuffix="-split" />);
    fireEvent.click(screen.getByTestId("download-all-zip"));
    await waitFor(() => {
      expect(buildZipBlob).toHaveBeenCalledWith(items, "myfile-split.zip");
      expect(downloadMock).toHaveBeenCalledTimes(1);
    });
  });

  it("falls back to 'output.zip' when archiveBasename and archiveSuffix are undefined", async () => {
    const items = [makeItem("a.pdf"), makeItem("b.pdf")];
    render(<ResultList items={items} />);
    fireEvent.click(screen.getByTestId("download-all-zip"));
    await waitFor(() => {
      expect(buildZipBlob).toHaveBeenCalledWith(items, "output.zip");
    });
  });

  it("disables the download-all button while zipping", async () => {
    // Make buildZipBlob hang so we can observe the busy state.
    let resolveZip: (v: { filename: string; blob: Blob }) => void = () => undefined;
    const zipPromise = new Promise<{ filename: string; blob: Blob }>((resolve) => {
      resolveZip = resolve;
    });
    vi.mocked(buildZipBlob).mockImplementationOnce(() => zipPromise);

    const items = [makeItem("a.pdf"), makeItem("b.pdf")];
    render(<ResultList items={items} />);
    const btn = screen.getByTestId("download-all-zip");
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());
    expect(btn).toHaveTextContent("[ packing... ]");
    resolveZip({ filename: "out.zip", blob: new Blob([]) });
    await waitFor(() => expect(btn).not.toBeDisabled());
  });
});
