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

  describe("warnings", () => {
    it("renders no warning notice when warnings is unset (existing engines)", () => {
      const item = makeItem("a.pdf");
      render(<ResultList items={[item]} />);
      expect(screen.queryByTestId("output-warnings")).not.toBeInTheDocument();
    });

    it("renders no warning notice when warnings is an empty array", () => {
      const item = { ...makeItem("a.pdf"), warnings: [] };
      render(<ResultList items={[item]} />);
      expect(screen.queryByTestId("output-warnings")).not.toBeInTheDocument();
    });

    it("renders a one-line notice with the joined warnings when present", () => {
      const item = { ...makeItem("a.pdf"), warnings: ["equation skipped", "drawing skipped"] };
      render(<ResultList items={[item]} />);
      const notice = screen.getByTestId("output-warnings");
      expect(notice).toBeInTheDocument();
      expect(notice).toHaveTextContent("2 features unsupported");
      expect(notice).toHaveTextContent("equation skipped");
      expect(notice).toHaveTextContent("drawing skipped");
    });

    it("uses singular 'feature' for exactly one warning", () => {
      const item = { ...makeItem("a.pdf"), warnings: ["RTL paragraph skipped"] };
      render(<ResultList items={[item]} />);
      expect(screen.getByTestId("output-warnings")).toHaveTextContent("1 feature unsupported");
    });

    it("truncates with ellipsis when more than 3 warnings", () => {
      const item = {
        ...makeItem("a.pdf"),
        warnings: ["a", "b", "c", "d", "e"],
      };
      render(<ResultList items={[item]} />);
      const notice = screen.getByTestId("output-warnings");
      expect(notice).toHaveTextContent("5 features unsupported");
      expect(notice).toHaveTextContent("a, b, c, …");
      expect(notice).not.toHaveTextContent(/\bd\b/);
    });
  });
});
