import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResultList } from "./result-list";

vi.mock("@/lib/download", () => ({ download: vi.fn() }));
import { download as downloadMock } from "@/lib/download";

afterEach(() => vi.clearAllMocks());

describe("ResultList", () => {
  it("renders nothing when items is empty", () => {
    const { container } = render(<ResultList items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one row per item with a download button", () => {
    render(
      <ResultList
        items={[
          { filename: "a.png", mime: "image/png", blob: new Blob(["a"]) },
          { filename: "b.png", mime: "image/png", blob: new Blob(["b"]) },
        ]}
      />,
    );
    expect(screen.getAllByRole("button", { name: /^download / })).toHaveLength(2);
    expect(screen.getByText("a.png")).toBeInTheDocument();
  });

  it("invokes download with the item's blob and filename when clicked", () => {
    const item = { filename: "a.png", mime: "image/png", blob: new Blob(["a"]) };
    render(<ResultList items={[item]} />);
    fireEvent.click(screen.getByRole("button", { name: /^download / }));
    expect(downloadMock).toHaveBeenCalledWith(item.blob, item.filename);
  });
});
