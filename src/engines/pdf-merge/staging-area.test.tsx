import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type PdfMergeOptions, type PdfMergeRow, defaultPdfMergeOptions } from "./options";

vi.mock("@/engines/_shared/render-pdf-thumbnail", () => ({
  renderFirstPageThumbnail: vi.fn(async () => {
    throw new Error("stubbed thumbnail failure");
  }),
}));

vi.mock("pdf-lib", () => {
  class EncryptedPDFError extends Error {
    constructor() {
      super("encrypted");
      this.name = "EncryptedPDFError";
    }
  }
  return {
    EncryptedPDFError,
    PDFDocument: {
      load: vi.fn(async (_bytes: ArrayBuffer) => ({
        getPageCount: () => 5,
      })),
    },
  };
});

import { PdfMergeStagingArea } from "./staging-area";

afterEach(() => vi.clearAllMocks());
// Restore the default pdf-lib mock implementation between tests so that a
// mockImplementation override in one test doesn't bleed into the next.
beforeEach(async () => {
  const { PDFDocument } = await import("pdf-lib");
  (PDFDocument.load as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async (_bytes: ArrayBuffer) => ({ getPageCount: () => 5 }),
  );
});

function makeFile(name: string): File {
  return new File([new Uint8Array(100)], name, { type: "application/pdf" });
}

function lastSetOptionsCall(setOptions: ReturnType<typeof vi.fn>): PdfMergeOptions {
  return setOptions.mock.calls[setOptions.mock.calls.length - 1]?.[0] as PdfMergeOptions;
}

describe("PdfMergeStagingArea", () => {
  it("creates one row per added file with allocated UUID id", () => {
    const files = [makeFile("a.pdf"), makeFile("b.pdf")];
    const onChange = vi.fn();
    const setOptions = vi.fn();
    render(
      <PdfMergeStagingArea
        files={files}
        onChange={onChange}
        options={defaultPdfMergeOptions}
        setOptions={setOptions}
      />,
    );
    expect(setOptions).toHaveBeenCalled();
    const last = lastSetOptionsCall(setOptions);
    expect(last.rows).toHaveLength(2);
    expect(last.rows[0]?.id).toBeTruthy();
    expect(last.rows[0]?.id).not.toBe(last.rows[1]?.id);
    expect(last.rows[0]?.fileName).toBe("a.pdf");
    expect(last.rows[1]?.fileName).toBe("b.pdf");
  });

  it("renders rows from options.rows when provided", () => {
    const rows: PdfMergeRow[] = [
      {
        id: "r1",
        fileName: "alpha.pdf",
        pageCount: 5,
        encrypted: false,
        rangeInput: "",
        parsedRange: [0, 1, 2, 3, 4],
        rangeError: undefined,
      },
    ];
    render(
      <PdfMergeStagingArea
        files={[makeFile("alpha.pdf")]}
        onChange={() => undefined}
        options={{ rows }}
        setOptions={() => undefined}
      />,
    );
    expect(screen.getByText("alpha.pdf")).toBeInTheDocument();
    expect(screen.getByText("5 pages")).toBeInTheDocument();
  });

  it("shows '[ password-protected ]' when row.encrypted", () => {
    const rows: PdfMergeRow[] = [
      {
        id: "r1",
        fileName: "secret.pdf",
        pageCount: 0,
        encrypted: true,
        rangeInput: "",
        parsedRange: [],
        rangeError: undefined,
      },
    ];
    render(
      <PdfMergeStagingArea
        files={[makeFile("secret.pdf")]}
        onChange={() => undefined}
        options={{ rows }}
        setOptions={() => undefined}
      />,
    );
    expect(screen.getByText("[ password-protected ]")).toBeInTheDocument();
  });

  it("range input typing updates parsedRange and clears rangeError on valid input", () => {
    const rows: PdfMergeRow[] = [
      {
        id: "r1",
        fileName: "x.pdf",
        pageCount: 5,
        encrypted: false,
        rangeInput: "",
        parsedRange: [0, 1, 2, 3, 4],
        rangeError: undefined,
      },
    ];
    const setOptions = vi.fn();
    render(
      <PdfMergeStagingArea
        files={[makeFile("x.pdf")]}
        onChange={() => undefined}
        options={{ rows }}
        setOptions={setOptions}
      />,
    );
    setOptions.mockClear();
    fireEvent.change(screen.getByTestId("range-input"), { target: { value: "1-3" } });
    const last = lastSetOptionsCall(setOptions);
    expect(last.rows[0]?.rangeInput).toBe("1-3");
    expect(last.rows[0]?.parsedRange).toEqual([0, 1, 2]);
    expect(last.rows[0]?.rangeError).toBeUndefined();
  });

  it("range input typing sets rangeError on out-of-bounds", () => {
    const rows: PdfMergeRow[] = [
      {
        id: "r1",
        fileName: "x.pdf",
        pageCount: 5,
        encrypted: false,
        rangeInput: "",
        parsedRange: [0, 1, 2, 3, 4],
        rangeError: undefined,
      },
    ];
    const setOptions = vi.fn();
    render(
      <PdfMergeStagingArea
        files={[makeFile("x.pdf")]}
        onChange={() => undefined}
        options={{ rows }}
        setOptions={setOptions}
      />,
    );
    setOptions.mockClear();
    fireEvent.change(screen.getByTestId("range-input"), { target: { value: "7-10" } });
    const last = lastSetOptionsCall(setOptions);
    expect(last.rows[0]?.rangeError).toMatch(/exceeds 5/);
    expect(last.rows[0]?.parsedRange).toEqual([]);
  });

  it("move-up reorders both files and rows in lockstep", () => {
    const fileA = makeFile("a.pdf");
    const fileB = makeFile("b.pdf");
    const rows: PdfMergeRow[] = [
      {
        id: "r1",
        fileName: "a.pdf",
        pageCount: 5,
        encrypted: false,
        rangeInput: "",
        parsedRange: [0, 1, 2, 3, 4],
        rangeError: undefined,
      },
      {
        id: "r2",
        fileName: "b.pdf",
        pageCount: 5,
        encrypted: false,
        rangeInput: "",
        parsedRange: [0, 1, 2, 3, 4],
        rangeError: undefined,
      },
    ];
    const onChange = vi.fn();
    const setOptions = vi.fn();
    render(
      <PdfMergeStagingArea
        files={[fileA, fileB]}
        onChange={onChange}
        options={{ rows }}
        setOptions={setOptions}
      />,
    );
    onChange.mockClear();
    setOptions.mockClear();
    const upButtons = screen.getAllByTestId("move-up");
    const upBtn1 = upButtons[1];
    if (!upBtn1) throw new Error("move-up[1] not found");
    fireEvent.click(upBtn1);
    expect(onChange).toHaveBeenCalledWith([fileB, fileA]);
    const last = lastSetOptionsCall(setOptions);
    expect(last.rows.map((r) => r.id)).toEqual(["r2", "r1"]);
  });

  it("remove drops both file and row by id", () => {
    const fileA = makeFile("a.pdf");
    const fileB = makeFile("b.pdf");
    const rows: PdfMergeRow[] = [
      {
        id: "r1",
        fileName: "a.pdf",
        pageCount: 5,
        encrypted: false,
        rangeInput: "",
        parsedRange: [0, 1, 2, 3, 4],
        rangeError: undefined,
      },
      {
        id: "r2",
        fileName: "b.pdf",
        pageCount: 5,
        encrypted: false,
        rangeInput: "",
        parsedRange: [0, 1, 2, 3, 4],
        rangeError: undefined,
      },
    ];
    const onChange = vi.fn();
    const setOptions = vi.fn();
    render(
      <PdfMergeStagingArea
        files={[fileA, fileB]}
        onChange={onChange}
        options={{ rows }}
        setOptions={setOptions}
      />,
    );
    onChange.mockClear();
    setOptions.mockClear();
    const removes = screen.getAllByTestId("remove");
    const remove0 = removes[0];
    if (!remove0) throw new Error("remove[0] not found");
    fireEvent.click(remove0);
    expect(onChange).toHaveBeenCalledWith([fileB]);
    const last = lastSetOptionsCall(setOptions);
    expect(last.rows.map((r) => r.id)).toEqual(["r2"]);
  });

  it("falls back to '?' placeholder when thumbnail render fails", async () => {
    // Use a controlled wrapper so setOptions feeds back into options,
    // allowing the component to render rows after file-add.
    const stableFile = makeFile("a.pdf");
    const stableFiles = [stableFile];
    function Wrapper() {
      const [options, setOptions] = React.useState<PdfMergeOptions>(defaultPdfMergeOptions);
      return (
        <PdfMergeStagingArea
          files={stableFiles}
          onChange={() => undefined}
          options={options}
          setOptions={setOptions}
        />
      );
    }
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText("?")).toBeInTheDocument();
    });
  });

  it("shows '[ password-protected ]' when pdf-lib throws an EncryptedPDFError", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const loadSpy = PDFDocument.load as unknown as ReturnType<typeof vi.fn>;
    // Replace the default implementation entirely so stray async calls from
    // preceding tests don't consume a "Once" mock.
    loadSpy.mockImplementation(async () => {
      throw new Error("Input document to `PDFDocument.load` is encrypted.");
    });

    const onChange = vi.fn();
    const setOptions = vi.fn();
    const stableFile = makeFile("secret.pdf");
    const stableFiles = [stableFile];
    function Wrapper() {
      const [opts, setOpts] = React.useState<PdfMergeOptions>(defaultPdfMergeOptions);
      return (
        <PdfMergeStagingArea
          files={stableFiles}
          onChange={onChange}
          options={opts}
          setOptions={(next) => {
            setOptions(next);
            setOpts(next);
          }}
        />
      );
    }
    render(<Wrapper />);
    await waitFor(() => {
      expect(screen.getByText("[ password-protected ]")).toBeInTheDocument();
    });
  });

  it("re-parses range against new pageCount when metadata resolves", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const loadSpy = PDFDocument.load as unknown as ReturnType<typeof vi.fn>;
    loadSpy.mockResolvedValueOnce({ getPageCount: () => 5 });

    const onChange = vi.fn();
    const setOptions = vi.fn();
    const stableFile = makeFile("a.pdf");
    const stableFiles = [stableFile];
    function Wrapper() {
      const [opts, setOpts] = React.useState<PdfMergeOptions>(defaultPdfMergeOptions);
      return (
        <PdfMergeStagingArea
          files={stableFiles}
          onChange={onChange}
          options={opts}
          setOptions={(next) => {
            setOptions(next);
            setOpts(next);
          }}
        />
      );
    }
    render(<Wrapper />);

    // Wait for metadata to land, then verify the row's parsedRange covers all 5 pages
    // (default empty rangeInput → all pages).
    await waitFor(() => {
      const lastCall = setOptions.mock.calls[
        setOptions.mock.calls.length - 1
      ]?.[0] as PdfMergeOptions;
      expect(lastCall?.rows[0]?.pageCount).toBe(5);
      expect(lastCall?.rows[0]?.parsedRange).toEqual([0, 1, 2, 3, 4]);
    });
  });

  it("commits decode result under React Strict Mode (no double-mount cancellation)", async () => {
    const { StrictMode } = await import("react");
    const stableFile = makeFile("a.pdf");
    const stableFiles = [stableFile];
    function Wrapper() {
      const [opts, setOpts] = React.useState<PdfMergeOptions>(defaultPdfMergeOptions);
      return (
        <PdfMergeStagingArea
          files={stableFiles}
          onChange={() => undefined}
          options={opts}
          setOptions={setOpts}
        />
      );
    }
    render(
      <StrictMode>
        <Wrapper />
      </StrictMode>,
    );
    await waitFor(() => {
      // Default mock returns getPageCount: () => 5; thumbnail mock throws,
      // so we should see "?" placeholder (thumbnail failed) AND the row should
      // have rendered without being killed by Strict Mode's double-mount.
      expect(screen.getByText("?")).toBeInTheDocument();
    });
  });
});
