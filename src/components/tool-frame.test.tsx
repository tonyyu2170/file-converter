import type { ConversionEngine, OutputItem, ValidationResult } from "@/engines/_shared/types";
import { __resetForTests as resetActiveConversion } from "@/hooks/use-active-conversion";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolFrame } from "./tool-frame";

afterEach(() => {
  vi.restoreAllMocks();
  resetActiveConversion();
});

type StubOpts = { ready: boolean };

// Allocation-free File for size-cap tests. The cap check reads .size only,
// so we override that property and skip the underlying Blob byte buffer.
// CRITICAL on an 8GB dev box: a literal `new Uint8Array(600_000_000)` here
// would allocate 600 MB per test, and Vitest runs files in parallel.
function fakeFile(name: string, type: string, size: number): File {
  const f = new File([], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

function makeStubEngine(
  overrides: Partial<ConversionEngine<StubOpts, OutputItem>> = {},
): ConversionEngine<StubOpts, OutputItem> {
  return {
    id: "stub",
    inputAccept: [".bin"],
    inputMime: ["application/octet-stream"],
    outputMime: "application/octet-stream",
    defaultOptions: { ready: true },
    category: "image",
    cardinality: "single",
    validate: (): ValidationResult => ({ ok: true }),
    convert: vi.fn(async () => ({
      filename: "out.bin",
      mime: "application/octet-stream",
      blob: new Blob(["x"]),
    })),
    ...overrides,
  } as ConversionEngine<StubOpts, OutputItem>;
}

describe("ToolFrame", () => {
  it("renders the engine id and READY status on mount with no staged file", () => {
    const engine = makeStubEngine();
    render(<ToolFrame engine={engine} />);
    expect(screen.getByText(/tool: stub/)).toBeInTheDocument();
    expect(screen.getByTestId("status-indicator")).toHaveTextContent("[ READY ]");
  });

  it("disables the Convert button when isReadyToConvert returns false", async () => {
    const engine = makeStubEngine({
      isReadyToConvert: () => false,
    });
    render(<ToolFrame engine={engine} />);

    const file = new File(["x"], "in.bin", { type: "application/octet-stream" });
    fireEvent.drop(screen.getByTestId("drop-zone"), {
      dataTransfer: { files: [file] },
    });

    await screen.findByTestId("clear-staged-file");
    expect(screen.getByTestId("convert-button")).toBeDisabled();
  });

  it("the DropZone is enabled regardless of isReadyToConvert for single-cardinality engines", () => {
    const engine = makeStubEngine({ isReadyToConvert: () => false });
    render(<ToolFrame engine={engine} />);
    expect(screen.getByTestId("drop-zone")).not.toHaveAttribute("data-state", "disabled");
  });

  it("surfaces validate failure as an error message and ERROR status", async () => {
    const engine = makeStubEngine({
      validate: () => ({ ok: false, reason: "no good" }),
    });
    render(<ToolFrame engine={engine} />);
    const file = new File(["x"], "x.bin", { type: "application/octet-stream" });
    fireEvent.drop(screen.getByTestId("drop-zone"), {
      dataTransfer: { files: [file] },
    });
    await waitFor(() => {
      expect(screen.getByTestId("convert-button")).not.toBeDisabled();
    });
    fireEvent.click(screen.getByTestId("convert-button"));
    await waitFor(() => {
      expect(screen.getByText("no good")).toBeInTheDocument();
    });
    expect(screen.getByTestId("status-indicator")).toHaveTextContent("[ ERROR ]");
  });

  it("renders the OptionsPanel when the engine declares one", () => {
    const Panel = ({ value }: { value: StubOpts; onChange: (n: StubOpts) => void }) => (
      <div data-testid="stub-panel">ready={String(value.ready)}</div>
    );
    const engine = makeStubEngine({ OptionsPanel: Panel });
    render(<ToolFrame engine={engine} />);
    expect(screen.getByTestId("stub-panel")).toBeInTheDocument();
  });

  it("single-cardinality drop stages the file and does NOT call convert", async () => {
    const convert = vi.fn(async () => ({
      filename: "out.bin",
      mime: "application/octet-stream",
      blob: new Blob(["x"]),
    }));
    const engine = makeStubEngine({ convert });
    render(<ToolFrame engine={engine} />);

    const file = new File(["x"], "in.bin", { type: "application/octet-stream" });
    fireEvent.drop(screen.getByTestId("drop-zone"), {
      dataTransfer: { files: [file] },
    });

    await waitFor(() => {
      expect(screen.getByTestId("clear-staged-file")).toBeInTheDocument();
    });
    expect(screen.getByText("in.bin")).toBeInTheDocument();
    expect(convert).not.toHaveBeenCalled();
  });

  it("single-cardinality Convert button click fires convert with the staged file", async () => {
    const convert = vi.fn(async () => ({
      filename: "out.bin",
      mime: "application/octet-stream",
      blob: new Blob(["x"]),
    }));
    const engine = makeStubEngine({ convert });
    render(<ToolFrame engine={engine} />);

    const file = new File(["x"], "in.bin", { type: "application/octet-stream" });
    fireEvent.drop(screen.getByTestId("drop-zone"), {
      dataTransfer: { files: [file] },
    });

    await screen.findByTestId("clear-staged-file");
    await waitFor(() => {
      expect(screen.getByTestId("convert-button")).not.toBeDisabled();
    });

    fireEvent.click(screen.getByTestId("convert-button"));

    await waitFor(() => {
      expect(convert).toHaveBeenCalledOnce();
    });
    expect(convert).toHaveBeenCalledWith(
      file,
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("single-cardinality re-drop replaces staged file and clears prior state", async () => {
    const convert = vi.fn(async () => ({
      filename: "out.bin",
      mime: "application/octet-stream",
      blob: new Blob(["x"]),
    }));
    const engine = makeStubEngine({ convert });
    render(<ToolFrame engine={engine} />);

    const a = new File(["a"], "a.bin", { type: "application/octet-stream" });
    const b = new File(["b"], "b.bin", { type: "application/octet-stream" });

    fireEvent.drop(screen.getByTestId("drop-zone"), { dataTransfer: { files: [a] } });
    await waitFor(() => {
      expect(screen.getByText("a.bin")).toBeInTheDocument();
    });

    fireEvent.drop(screen.getByTestId("drop-zone"), { dataTransfer: { files: [b] } });
    await waitFor(() => {
      expect(screen.getByText("b.bin")).toBeInTheDocument();
    });
    expect(screen.queryByText("a.bin")).toBeNull();
    expect(convert).not.toHaveBeenCalled();
  });

  it("single-cardinality clear-staged-file empties staging", async () => {
    const engine = makeStubEngine();
    render(<ToolFrame engine={engine} />);

    const file = new File(["x"], "in.bin", { type: "application/octet-stream" });
    fireEvent.drop(screen.getByTestId("drop-zone"), {
      dataTransfer: { files: [file] },
    });

    await screen.findByTestId("clear-staged-file");

    fireEvent.click(screen.getByTestId("clear-staged-file"));

    expect(screen.queryByTestId("clear-staged-file")).toBeNull();
    expect(screen.queryByText(/current file:/i)).toBeNull();
    expect(screen.getByTestId("convert-button")).toBeDisabled();
  });

  it("single-cardinality clear-staged-file is disabled while converting", async () => {
    let resolveConvert: (v: OutputItem) => void = () => {};
    const convert = vi.fn(
      () =>
        new Promise<OutputItem>((r) => {
          resolveConvert = r;
        }),
    );
    const engine = makeStubEngine({ convert });
    render(<ToolFrame engine={engine} />);

    const file = new File(["x"], "in.bin", { type: "application/octet-stream" });
    fireEvent.drop(screen.getByTestId("drop-zone"), {
      dataTransfer: { files: [file] },
    });

    await screen.findByTestId("clear-staged-file");
    await waitFor(() => {
      expect(screen.getByTestId("convert-button")).not.toBeDisabled();
    });

    fireEvent.click(screen.getByTestId("convert-button"));

    await waitFor(() => {
      expect(screen.getByTestId("clear-staged-file")).toBeDisabled();
    });

    resolveConvert({
      filename: "out.bin",
      mime: "application/octet-stream",
      blob: new Blob(["x"]),
    });

    await waitFor(() => {
      expect(screen.getByTestId("status-indicator")).toHaveTextContent("[ DONE ]");
    });
  });

  it("multi-cardinality: renders staged-totals (count + total size) once files are dropped", async () => {
    const Staging = ({
      files,
    }: { files: File[]; onChange: (n: File[]) => void; options: unknown }) => (
      <div data-testid="staging-files">{files.length} files</div>
    );
    const engine = {
      ...makeStubEngine(),
      cardinality: "multi" as const,
      validate: (() => ({ ok: true }) as const) as never,
      convert: vi.fn(async () => ({
        filename: "out.pdf",
        mime: "application/pdf",
        blob: new Blob(["x"]),
      })) as never,
      StagingArea: Staging,
    } as unknown as ConversionEngine<StubOpts, OutputItem>;

    render(<ToolFrame engine={engine} />);
    expect(screen.queryByTestId("staged-totals")).toBeNull();

    const f1 = new File([new Uint8Array(1_000_000)], "a.png", { type: "image/png" });
    const f2 = new File([new Uint8Array(3_200_000)], "b.jpg", { type: "image/jpeg" });
    fireEvent.drop(screen.getByTestId("drop-zone"), { dataTransfer: { files: [f1, f2] } });

    const totals = await screen.findByTestId("staged-totals");
    expect(totals).toHaveTextContent("2");
    expect(totals).toHaveTextContent("files");
    expect(totals).toHaveTextContent("4.2 MB");
  });

  it("multi-cardinality: renders output-estimate when engine implements estimateOutputBytes", async () => {
    const Staging = ({
      files,
    }: { files: File[]; onChange: (n: File[]) => void; options: unknown }) => (
      <div data-testid="staging-files">{files.length} files</div>
    );
    const engine = {
      ...makeStubEngine(),
      cardinality: "multi" as const,
      validate: (() => ({ ok: true }) as const) as never,
      convert: vi.fn() as never,
      StagingArea: Staging,
      estimateOutputBytes: (files: File[]) =>
        files.length < 2 ? null : files.reduce((s, f) => s + f.size, 0),
    } as unknown as ConversionEngine<StubOpts, OutputItem>;

    render(<ToolFrame engine={engine} />);

    // 1 file: estimate hidden (engine returns null)
    const f1 = new File([new Uint8Array(1_000_000)], "a.pdf", { type: "application/pdf" });
    fireEvent.drop(screen.getByTestId("drop-zone"), { dataTransfer: { files: [f1] } });
    await screen.findByTestId("staged-totals");
    expect(screen.queryByTestId("output-estimate")).toBeNull();

    // 2 files: estimate shown
    const f2 = new File([new Uint8Array(3_200_000)], "b.pdf", { type: "application/pdf" });
    fireEvent.drop(screen.getByTestId("drop-zone"), { dataTransfer: { files: [f2] } });
    const est = await screen.findByTestId("output-estimate");
    expect(est).toHaveTextContent("4.2 MB");
  });

  it("renders engine.StagingArea and Convert button for multi-cardinality engines", () => {
    const Staging = ({
      files,
    }: { files: File[]; onChange: (n: File[]) => void; options: unknown }) => (
      <div data-testid="staging-files">{files.length} files</div>
    );
    const engine = {
      ...makeStubEngine(),
      cardinality: "multi" as const,
      validate: (() => ({ ok: true }) as const) as never,
      convert: vi.fn(async () => ({
        filename: "out.pdf",
        mime: "application/pdf",
        blob: new Blob(["x"]),
      })) as never,
      StagingArea: Staging,
    } as unknown as ConversionEngine<StubOpts, OutputItem>;

    render(<ToolFrame engine={engine} />);
    // No staging visible until something is dropped/staged.
    expect(screen.queryByTestId("staging-files")).toBeNull();
    // Convert button is present and disabled.
    expect(screen.getByTestId("convert-button")).toBeDisabled();
  });

  it("single-cardinality: shows input file size next to the staged filename", async () => {
    const engine = makeStubEngine();
    render(<ToolFrame engine={engine} />);

    const file = new File([new Uint8Array(4_200_000)], "in.bin", {
      type: "application/octet-stream",
    });
    fireEvent.drop(screen.getByTestId("drop-zone"), {
      dataTransfer: { files: [file] },
    });

    await screen.findByTestId("clear-staged-file");
    expect(screen.getByText("4.2 MB")).toBeInTheDocument();
  });

  it("single-cardinality: hides output-estimate when engine has no estimateOutputBytes", async () => {
    const engine = makeStubEngine();
    render(<ToolFrame engine={engine} />);

    const file = new File([new Uint8Array(100)], "in.bin", { type: "application/octet-stream" });
    fireEvent.drop(screen.getByTestId("drop-zone"), { dataTransfer: { files: [file] } });

    await screen.findByTestId("clear-staged-file");
    expect(screen.queryByTestId("output-estimate")).toBeNull();
  });

  it("single-cardinality: renders output-estimate when engine.estimateOutputBytes returns a number", async () => {
    const engine = makeStubEngine({
      estimateOutputBytes: (file: File) => file.size * 2,
    });
    render(<ToolFrame engine={engine} />);

    const file = new File([new Uint8Array(2_100_000)], "in.bin", {
      type: "application/octet-stream",
    });
    fireEvent.drop(screen.getByTestId("drop-zone"), { dataTransfer: { files: [file] } });

    await screen.findByTestId("clear-staged-file");
    const est = await screen.findByTestId("output-estimate");
    expect(est).toHaveTextContent("4.2 MB");
  });

  it("passes inputBytes (snapshot at conversion start) to ResultList for the delta header", async () => {
    const convert = vi.fn(async () => ({
      filename: "out.bin",
      mime: "application/octet-stream",
      blob: new Blob([new Uint8Array(800_000)]),
    }));
    const engine = makeStubEngine({ convert });
    render(<ToolFrame engine={engine} />);

    const file = new File([new Uint8Array(1_000_000)], "in.bin", {
      type: "application/octet-stream",
    });
    fireEvent.drop(screen.getByTestId("drop-zone"), { dataTransfer: { files: [file] } });

    await screen.findByTestId("clear-staged-file");
    await waitFor(() => expect(screen.getByTestId("convert-button")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("convert-button"));

    await waitFor(() => expect(convert).toHaveBeenCalledOnce());
    const delta = await screen.findByTestId("size-delta");
    expect(delta).toHaveTextContent("1 MB");
    expect(delta).toHaveTextContent("800 KB");
    expect(delta).toHaveTextContent("-20%");
  });

  it("clearing the staged file removes the prior delta header for the next render cycle", async () => {
    const convert = vi.fn(async () => ({
      filename: "out.bin",
      mime: "application/octet-stream",
      blob: new Blob([new Uint8Array(500)]),
    }));
    const engine = makeStubEngine({ convert });
    render(<ToolFrame engine={engine} />);

    const file = new File([new Uint8Array(1000)], "in.bin", {
      type: "application/octet-stream",
    });
    fireEvent.drop(screen.getByTestId("drop-zone"), { dataTransfer: { files: [file] } });
    await screen.findByTestId("clear-staged-file");
    fireEvent.click(screen.getByTestId("convert-button"));
    await screen.findByTestId("size-delta");

    fireEvent.click(screen.getByTestId("clear-staged-file"));
    expect(screen.queryByTestId("size-delta")).toBeNull();
  });

  it("Convert button click fires run with stagedFiles", async () => {
    let stagedRef: File[] = [];
    const Staging = ({
      files,
      onChange,
    }: { files: File[]; onChange: (n: File[]) => void; options: unknown }) => {
      stagedRef = files;
      void onChange;
      return <div data-testid="staging-files">{files.length} files</div>;
    };
    const convert = vi.fn(async () => ({
      filename: "out.pdf",
      mime: "application/pdf",
      blob: new Blob(["x"]),
    }));
    const engine = {
      ...makeStubEngine(),
      cardinality: "multi" as const,
      validate: (() => ({ ok: true }) as const) as never,
      convert: convert as never,
      StagingArea: Staging,
    } as unknown as ConversionEngine<StubOpts, OutputItem>;

    render(<ToolFrame engine={engine} />);

    const f1 = new File(["a"], "a.png", { type: "image/png" });
    const f2 = new File(["b"], "b.jpg", { type: "image/jpeg" });
    fireEvent.drop(screen.getByTestId("drop-zone"), {
      dataTransfer: { files: [f1, f2] },
    });

    await waitFor(() => {
      expect(stagedRef.length).toBe(2);
    });
    await waitFor(() => {
      expect(screen.getByTestId("convert-button")).not.toBeDisabled();
    });

    fireEvent.click(screen.getByTestId("convert-button"));

    await waitFor(() => {
      expect(convert).toHaveBeenCalledOnce();
    });
    expect(convert).toHaveBeenCalledWith(
      [f1, f2],
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("single-cardinality: rejects drop of a file over the per-category hard cap", () => {
    const engine = makeStubEngine({ category: "image" });
    render(<ToolFrame engine={engine} />);
    const huge = fakeFile("huge.bin", "application/octet-stream", 260_000_000);
    fireEvent.drop(screen.getByTestId("drop-zone"), { dataTransfer: { files: [huge] } });
    expect(screen.queryByTestId("clear-staged-file")).toBeNull();
    expect(screen.getByTestId("status-indicator")).toHaveTextContent("[ ERROR ]");
    expect(screen.getByText(/exceeds the 250 MB cap for image tools/i)).toBeInTheDocument();
  });

  it("multi-cardinality: rejects entire drop if any file is over hard cap; prior staging unchanged", () => {
    const Staging = ({
      files,
    }: { files: File[]; onChange: (n: File[]) => void; options: unknown }) => (
      <div data-testid="staging-files">{files.length} files</div>
    );
    const engine = {
      ...makeStubEngine(),
      cardinality: "multi" as const,
      category: "pdf" as const,
      validate: (() => ({ ok: true }) as const) as never,
      convert: vi.fn() as never,
      StagingArea: Staging,
    } as unknown as ConversionEngine<StubOpts, OutputItem>;

    render(<ToolFrame engine={engine} />);
    const small = fakeFile("small.pdf", "application/pdf", 1_000);
    fireEvent.drop(screen.getByTestId("drop-zone"), { dataTransfer: { files: [small] } });

    expect(screen.getByTestId("staging-files")).toHaveTextContent("1 files");

    const huge = fakeFile("huge.pdf", "application/pdf", 600_000_000);
    const ok = fakeFile("ok.pdf", "application/pdf", 2_000);
    fireEvent.drop(screen.getByTestId("drop-zone"), { dataTransfer: { files: [huge, ok] } });

    // Prior staging unchanged; new drop atomically rejected.
    expect(screen.getByTestId("staging-files")).toHaveTextContent("1 files");
    expect(screen.getByText(/exceeds the 500 MB cap for pdf tools/i)).toBeInTheDocument();
  });

  it("single-cardinality: Convert label transforms when staged file is over soft cap", async () => {
    const engine = makeStubEngine({ category: "image" });
    render(<ToolFrame engine={engine} />);
    // 60 MB > 50 MB image soft cap, < 250 MB hard cap.
    const big = fakeFile("big.bin", "application/octet-stream", 60_000_000);
    fireEvent.drop(screen.getByTestId("drop-zone"), { dataTransfer: { files: [big] } });
    await screen.findByTestId("clear-staged-file");
    const btn = screen.getByTestId("convert-button");
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveTextContent(/may be slow/i);
    expect(btn).toHaveTextContent("60 MB");
  });

  it("multi-cardinality: Convert label transforms when aggregate is over soft cap, under hard cap", async () => {
    const Staging = ({
      files,
    }: { files: File[]; onChange: (n: File[]) => void; options: unknown }) => (
      <div>{files.length} files</div>
    );
    const engine = {
      ...makeStubEngine(),
      cardinality: "multi" as const,
      category: "pdf" as const,
      validate: (() => ({ ok: true }) as const) as never,
      convert: vi.fn() as never,
      StagingArea: Staging,
    } as unknown as ConversionEngine<StubOpts, OutputItem>;

    render(<ToolFrame engine={engine} />);
    // 3 × 50 MB = 150 MB. Over pdf 100 MB soft, under 500 MB hard.
    const a = fakeFile("a.pdf", "application/pdf", 50_000_000);
    const b = fakeFile("b.pdf", "application/pdf", 50_000_000);
    const c = fakeFile("c.pdf", "application/pdf", 50_000_000);
    fireEvent.drop(screen.getByTestId("drop-zone"), { dataTransfer: { files: [a, b, c] } });

    await screen.findByTestId("staged-totals");
    const btn = screen.getByTestId("convert-button");
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveTextContent(/may be slow/i);
    expect(btn).toHaveTextContent("150 MB");
  });

  it("multi-cardinality: aggregate over hard cap disables Convert and adds totals suffix", async () => {
    const Staging = ({
      files,
    }: { files: File[]; onChange: (n: File[]) => void; options: unknown }) => (
      <div>{files.length} files</div>
    );
    const engine = {
      ...makeStubEngine(),
      cardinality: "multi" as const,
      category: "pdf" as const,
      validate: (() => ({ ok: true }) as const) as never,
      convert: vi.fn() as never,
      StagingArea: Staging,
    } as unknown as ConversionEngine<StubOpts, OutputItem>;

    render(<ToolFrame engine={engine} />);
    // 6 × 90 MB = 540 MB. Over pdf 500 MB hard. Each individual file
    // is 90 MB, well under 500 MB hard, so per-file drop check passes.
    const files = Array.from({ length: 6 }, (_, i) =>
      fakeFile(`f${i}.pdf`, "application/pdf", 90_000_000),
    );
    fireEvent.drop(screen.getByTestId("drop-zone"), { dataTransfer: { files } });

    await screen.findByTestId("staged-totals");
    const btn = screen.getByTestId("convert-button");
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent(/exceeds 500 mb cap/i);
    expect(screen.getByTestId("staged-totals")).toHaveTextContent(/over 500 MB cap/i);
  });

  it("Convert button shows plain '[ convert ]' when staged total is under soft cap", async () => {
    const engine = makeStubEngine({ category: "image" });
    render(<ToolFrame engine={engine} />);
    const small = fakeFile("small.bin", "application/octet-stream", 1_000_000);
    fireEvent.drop(screen.getByTestId("drop-zone"), { dataTransfer: { files: [small] } });
    await screen.findByTestId("clear-staged-file");
    expect(screen.getByTestId("convert-button")).toHaveTextContent("[ convert ]");
  });

  it("cap warnings override engine.convertButtonLabel when over hard cap (multi-cardinality)", async () => {
    const Staging = ({
      files,
    }: { files: File[]; onChange: (n: File[]) => void; options: unknown }) => (
      <div>{files.length} files</div>
    );
    const engine = {
      ...makeStubEngine(),
      cardinality: "multi" as const,
      category: "pdf" as const,
      convertButtonLabel: "[ merge ]",
      validate: (() => ({ ok: true }) as const) as never,
      convert: vi.fn() as never,
      StagingArea: Staging,
    } as unknown as ConversionEngine<StubOpts, OutputItem>;

    render(<ToolFrame engine={engine} />);
    const files = Array.from({ length: 6 }, (_, i) =>
      fakeFile(`f${i}.pdf`, "application/pdf", 90_000_000),
    );
    fireEvent.drop(screen.getByTestId("drop-zone"), { dataTransfer: { files } });

    await screen.findByTestId("staged-totals");
    const btn = screen.getByTestId("convert-button");
    expect(btn).toBeDisabled();
    // Cap message wins over engine custom label so the disabled state isn't unexplained.
    expect(btn).toHaveTextContent(/exceeds 500 mb cap/i);
    expect(btn).not.toHaveTextContent("[ merge ]");
  });

  it("renders a determinate <progress> bar when an engine emits model-loading events", async () => {
    // Never-resolving promise: the progress bar is rendered during the
    // 'converting' window and cleared at done/error. We must observe it
    // before the run completes, so convert() never resolves.
    const convert = vi.fn(
      (
        _f: File,
        _o: StubOpts,
        _s: AbortSignal,
        runOpts?: { onProgress?: (p: { kind: string; loaded?: number; total?: number }) => void },
      ) => {
        runOpts?.onProgress?.({ kind: "model-loading", loaded: 25, total: 100 });
        return new Promise<OutputItem>(() => {});
      },
    );
    const engine = makeStubEngine({ convert: convert as never });
    render(<ToolFrame engine={engine} />);

    const file = new File(["x"], "in.bin", { type: "application/octet-stream" });
    fireEvent.drop(screen.getByTestId("drop-zone"), {
      dataTransfer: { files: [file] },
    });

    await screen.findByTestId("clear-staged-file");
    await waitFor(() => expect(screen.getByTestId("convert-button")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("convert-button"));

    const slot = await screen.findByTestId("conversion-progress");
    expect(slot).toBeInTheDocument();
    // model-loading branch shows a determinate <progress> with value/max.
    const bar = slot.querySelector("progress");
    expect(bar).not.toBeNull();
    expect(bar).toHaveAttribute("value", "25");
    expect(bar).toHaveAttribute("max", "100");
  });

  it("renders an inference status line when an engine emits inference events", async () => {
    const convert = vi.fn(
      (
        _f: File,
        _o: StubOpts,
        _s: AbortSignal,
        runOpts?: { onProgress?: (p: { kind: string; pct?: number }) => void },
      ) => {
        runOpts?.onProgress?.({ kind: "inference", pct: 40 });
        return new Promise<OutputItem>(() => {});
      },
    );
    const engine = makeStubEngine({ convert: convert as never });
    render(<ToolFrame engine={engine} />);

    const file = new File(["x"], "in.bin", { type: "application/octet-stream" });
    fireEvent.drop(screen.getByTestId("drop-zone"), {
      dataTransfer: { files: [file] },
    });

    await screen.findByTestId("clear-staged-file");
    await waitFor(() => expect(screen.getByTestId("convert-button")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("convert-button"));

    const slot = await screen.findByTestId("conversion-progress");
    expect(slot).toBeInTheDocument();
    // Inference branch renders no <progress> element, just a status line.
    expect(slot.querySelector("progress")).toBeNull();
    expect(slot).toHaveTextContent(/inferring/i);
  });

  it("does NOT render a progress bar for engines that never emit progress events", async () => {
    const convert = vi.fn(async () => ({
      filename: "out.bin",
      mime: "application/octet-stream",
      blob: new Blob(["x"]),
    }));
    const engine = makeStubEngine({ convert });
    render(<ToolFrame engine={engine} />);

    const file = new File(["x"], "in.bin", { type: "application/octet-stream" });
    fireEvent.drop(screen.getByTestId("drop-zone"), {
      dataTransfer: { files: [file] },
    });

    await screen.findByTestId("clear-staged-file");
    await waitFor(() => expect(screen.getByTestId("convert-button")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("convert-button"));

    await waitFor(() =>
      expect(screen.getByTestId("status-indicator")).toHaveTextContent("[ DONE ]"),
    );
    expect(screen.queryByTestId("conversion-progress")).toBeNull();
  });

  it("clears the progress bar after the conversion completes", async () => {
    let resolveConvert: (v: OutputItem) => void = () => {};
    const convert = vi.fn(
      (
        _f: File,
        _o: StubOpts,
        _s: AbortSignal,
        runOpts?: { onProgress?: (p: { kind: string; loaded?: number; total?: number }) => void },
      ) => {
        runOpts?.onProgress?.({ kind: "model-loading", loaded: 50, total: 100 });
        return new Promise<OutputItem>((r) => {
          resolveConvert = r;
        });
      },
    );
    const engine = makeStubEngine({ convert: convert as never });
    render(<ToolFrame engine={engine} />);

    const file = new File(["x"], "in.bin", { type: "application/octet-stream" });
    fireEvent.drop(screen.getByTestId("drop-zone"), {
      dataTransfer: { files: [file] },
    });

    await screen.findByTestId("clear-staged-file");
    await waitFor(() => expect(screen.getByTestId("convert-button")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("convert-button"));

    await screen.findByTestId("conversion-progress");

    resolveConvert({
      filename: "out.bin",
      mime: "application/octet-stream",
      blob: new Blob(["x"]),
    });

    await waitFor(() =>
      expect(screen.getByTestId("status-indicator")).toHaveTextContent("[ DONE ]"),
    );
    expect(screen.queryByTestId("conversion-progress")).toBeNull();
  });

  it("installs beforeunload listener while converting and removes it after", async () => {
    // Use a slow convert so we can observe the converting state.
    let resolveConvert: (v: OutputItem) => void = () => undefined;
    const convertPromise = new Promise<OutputItem>((res) => {
      resolveConvert = res;
    });
    const convert = vi.fn(async () => convertPromise);
    const engine = makeStubEngine({ convert });

    resetActiveConversion();
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const beforeUnloadCalls = (spy: typeof addSpy) =>
      spy.mock.calls.filter((c) => (c[0] as string) === "beforeunload").length;

    render(<ToolFrame engine={engine} />);
    const file = new File(["x"], "in.bin", { type: "application/octet-stream" });
    fireEvent.drop(screen.getByTestId("drop-zone"), { dataTransfer: { files: [file] } });

    await screen.findByTestId("clear-staged-file");
    fireEvent.click(screen.getByTestId("convert-button"));

    await waitFor(() => expect(beforeUnloadCalls(addSpy)).toBe(1));
    expect(beforeUnloadCalls(removeSpy)).toBe(0);

    resolveConvert({
      filename: "out.bin",
      mime: "application/octet-stream",
      blob: new Blob(["y"]),
    });

    await waitFor(() => expect(beforeUnloadCalls(removeSpy)).toBe(1));
  });
});
