import type { ConversionEngine, OutputItem, ValidationResult } from "@/engines/_shared/types";
import { stageFiles, takeStagedFiles } from "@/lib/handoff";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolFrame } from "./tool-frame";

afterEach(() => {
  takeStagedFiles();
  vi.restoreAllMocks();
});

type StubOpts = { ready: boolean };

function makeStubEngine(
  overrides: Partial<ConversionEngine<StubOpts, OutputItem>> = {},
): ConversionEngine<StubOpts, OutputItem> {
  return {
    id: "stub",
    inputAccept: [".bin"],
    inputMime: ["application/octet-stream"],
    outputMime: "application/octet-stream",
    defaultOptions: { ready: true },
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

  it("disables the Convert button when isReadyToConvert returns false", () => {
    const engine = makeStubEngine({
      isReadyToConvert: () => false,
    });
    const staged = new File(["x"], "in.bin", { type: "application/octet-stream" });
    stageFiles([staged]);
    render(<ToolFrame engine={engine} />);
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

  it("stages a handed-off file on mount but does not auto-fire convert; click runs it once ready", async () => {
    const Panel = ({ value, onChange }: { value: StubOpts; onChange: (n: StubOpts) => void }) => (
      <button type="button" data-testid="ready-button" onClick={() => onChange({ ready: true })}>
        ready={String(value.ready)}
      </button>
    );
    const convert = vi.fn(async () => ({
      filename: "out.bin",
      mime: "application/octet-stream",
      blob: new Blob(["x"]),
    }));
    const engine = makeStubEngine({
      defaultOptions: { ready: false },
      isReadyToConvert: (opts) => opts.ready === true,
      OptionsPanel: Panel,
      convert,
    });

    const staged = new File(["x"], "in.bin", { type: "application/octet-stream" });
    stageFiles([staged]);

    render(<ToolFrame engine={engine} />);

    await waitFor(() => {
      expect(screen.getByTestId("clear-staged-file")).toBeInTheDocument();
    });
    expect(convert).not.toHaveBeenCalled();
    expect(screen.getByTestId("convert-button")).toBeDisabled();

    fireEvent.click(screen.getByTestId("ready-button"));

    expect(screen.getByTestId("convert-button")).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("convert-button"));

    await waitFor(() => {
      expect(convert).toHaveBeenCalledOnce();
    });
    expect(convert).toHaveBeenCalledWith(staged, expect.anything(), expect.anything());
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
    const file = new File(["x"], "in.bin", { type: "application/octet-stream" });
    stageFiles([file]);

    render(<ToolFrame engine={engine} />);

    await waitFor(() => {
      expect(screen.getByTestId("convert-button")).not.toBeDisabled();
    });

    fireEvent.click(screen.getByTestId("convert-button"));

    await waitFor(() => {
      expect(convert).toHaveBeenCalledOnce();
    });
    expect(convert).toHaveBeenCalledWith(file, expect.anything(), expect.anything());
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
    const file = new File(["x"], "in.bin", { type: "application/octet-stream" });
    stageFiles([file]);
    const engine = makeStubEngine();
    render(<ToolFrame engine={engine} />);

    await waitFor(() => {
      expect(screen.getByTestId("clear-staged-file")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("clear-staged-file"));

    expect(screen.queryByTestId("clear-staged-file")).toBeNull();
    expect(screen.queryByText(/current file:/i)).toBeNull();
    expect(screen.getByTestId("convert-button")).toBeDisabled();
  });

  it("cross-route handoff for single-cardinality populates staging without firing convert", async () => {
    const convert = vi.fn(async () => ({
      filename: "out.bin",
      mime: "application/octet-stream",
      blob: new Blob(["x"]),
    }));
    const engine = makeStubEngine({ convert });
    const file = new File(["x"], "handoff.bin", { type: "application/octet-stream" });
    stageFiles([file]);

    render(<ToolFrame engine={engine} />);

    await waitFor(() => {
      expect(screen.getByText("handoff.bin")).toBeInTheDocument();
    });
    expect(screen.getByTestId("clear-staged-file")).toBeInTheDocument();
    expect(convert).not.toHaveBeenCalled();
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

    const file = new File(["x"], "in.bin", { type: "application/octet-stream" });
    stageFiles([file]);

    render(<ToolFrame engine={engine} />);

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

  it("staged file from cross-route handoff populates a multi-cardinality engine's staging area without firing convert", async () => {
    const Staging = ({
      files,
    }: { files: File[]; onChange: (n: File[]) => void; options: unknown }) => (
      <div data-testid="staging-files">{files.length} files</div>
    );
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

    const f1 = new File(["a"], "a.png", { type: "image/png" });
    const f2 = new File(["b"], "b.jpg", { type: "image/jpeg" });
    stageFiles([f1, f2]);

    render(<ToolFrame engine={engine} />);

    await waitFor(() => {
      expect(screen.getByTestId("staging-files")).toHaveTextContent("2 files");
    });
    expect(convert).not.toHaveBeenCalled();
    expect(screen.getByTestId("convert-button")).not.toBeDisabled();
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

    const f1 = new File(["a"], "a.png", { type: "image/png" });
    const f2 = new File(["b"], "b.jpg", { type: "image/jpeg" });
    stageFiles([f1, f2]);

    render(<ToolFrame engine={engine} />);

    await waitFor(() => {
      expect(stagedRef.length).toBe(2);
    });

    fireEvent.click(screen.getByTestId("convert-button"));

    await waitFor(() => {
      expect(convert).toHaveBeenCalledOnce();
    });
    expect(convert).toHaveBeenCalledWith([f1, f2], expect.anything(), expect.anything());
  });
});
