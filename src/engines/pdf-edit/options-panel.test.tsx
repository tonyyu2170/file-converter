import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { type PdfEditOptions, seedFromPageCount } from "./options";
import { PdfEditOptionsPanel } from "./options-panel";

beforeAll(() => {
  if (typeof globalThis.IntersectionObserver === "undefined") {
    class MockIntersectionObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
      root = null;
      rootMargin = "";
      thresholds = [];
    }
    // biome-ignore lint/suspicious/noExplicitAny: jsdom polyfill
    globalThis.IntersectionObserver = MockIntersectionObserver as any;
  }
});

describe("PdfEditOptionsPanel", () => {
  it("renders one cell per page with the right page numbers and indicator", () => {
    const value = seedFromPageCount(3);
    render(<PdfEditOptionsPanel value={value} onChange={() => {}} />);
    expect(screen.getByTestId("page-cell-0")).toBeInTheDocument();
    expect(screen.getByTestId("page-cell-1")).toBeInTheDocument();
    expect(screen.getByTestId("page-cell-2")).toBeInTheDocument();
    expect(screen.getByTestId("page-indicator")).toHaveTextContent("3 pages");
  });

  it("rotate-all button calls onChange with all rotations advanced 90°", () => {
    const value = seedFromPageCount(2);
    const onChange = vi.fn<(opts: PdfEditOptions) => void>();
    render(<PdfEditOptionsPanel value={value} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("rotate-all"));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0];
    expect(next.pages.map((p) => p.rotation)).toEqual([90, 90]);
  });

  it("per-cell rotate cycles only that page", () => {
    const value = seedFromPageCount(2);
    const onChange = vi.fn<(opts: PdfEditOptions) => void>();
    render(<PdfEditOptionsPanel value={value} onChange={onChange} />);
    const rotateButtons = screen.getAllByTestId("rotate-btn");
    fireEvent.click(rotateButtons[0]!);
    const next = onChange.mock.calls[0]![0];
    expect(next.pages[0]!.rotation).toBe(90);
    expect(next.pages[1]!.rotation).toBe(0);
  });

  it("delete-button removes the page", () => {
    const value = seedFromPageCount(3);
    const onChange = vi.fn<(opts: PdfEditOptions) => void>();
    render(<PdfEditOptionsPanel value={value} onChange={onChange} />);
    fireEvent.click(screen.getAllByTestId("delete-btn")[1]!);
    const next = onChange.mock.calls[0]![0];
    expect(next.pages.length).toBe(2);
    expect(next.pages.map((p) => p.sourceIndex)).toEqual([0, 2]);
  });

  it("page indicator shows N → M when pages have been deleted", () => {
    const seeded = seedFromPageCount(5);
    const value = { ...seeded, pages: seeded.pages.slice(0, 3) };
    render(<PdfEditOptionsPanel value={value} onChange={() => {}} />);
    expect(screen.getByTestId("page-indicator")).toHaveTextContent("5 pages → 3 pages");
  });

  it("renders <img> when thumbnailUrl is supplied", () => {
    const value = seedFromPageCount(1);
    render(
      <PdfEditOptionsPanel
        value={value}
        onChange={() => {}}
        thumbnails={{ 0: "blob:thumbnail-mock" }}
      />,
    );
    const img = screen.getByTestId("page-thumbnail") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("blob:thumbnail-mock");
  });
});
