import type { ConversionEngine, OutputItem, ValidationResult } from "@/engines/_shared/types";
import { stageFile, takeStagedFile } from "@/lib/handoff";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolFrame } from "./tool-frame";

afterEach(() => {
  takeStagedFile();
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

  it("disables the DropZone when isReadyToConvert returns false", () => {
    const engine = makeStubEngine({
      isReadyToConvert: () => false,
    });
    render(<ToolFrame engine={engine} />);
    expect(screen.getByTestId("drop-zone")).toHaveAttribute("data-state", "disabled");
  });

  it("enables the DropZone when isReadyToConvert returns true (or is undefined)", () => {
    const engine = makeStubEngine();
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

  it("holds a staged file until isReadyToConvert flips to true, then runs conversion", async () => {
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
    stageFile(staged);

    render(<ToolFrame engine={engine} />);

    expect(convert).not.toHaveBeenCalled();
    expect(screen.getByTestId("drop-zone")).toHaveAttribute("data-state", "disabled");

    fireEvent.click(screen.getByTestId("ready-button"));

    await waitFor(() => {
      expect(convert).toHaveBeenCalledOnce();
    });
    expect(convert).toHaveBeenCalledWith(staged, expect.anything(), expect.anything());
  });
});
