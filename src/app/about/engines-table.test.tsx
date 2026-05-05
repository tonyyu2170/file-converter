import { listEngineIds } from "@/engines/_shared/registry";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EnginesTable } from "./engines-table";

describe("EnginesTable", () => {
  it("renders one row per registered engine after loading", async () => {
    render(<EnginesTable />);
    const table = await screen.findByTestId("engines-table", undefined, {
      timeout: 10_000,
    });
    expect(table).toBeInTheDocument();
    for (const id of listEngineIds()) {
      expect(screen.getByTestId(`engine-row-${id}`)).toBeInTheDocument();
    }
  });

  it("displays the library + license values from each engine descriptor", async () => {
    render(<EnginesTable />);
    const pdfMergeRow = await screen.findByTestId("engine-row-pdf-merge", undefined, {
      timeout: 10_000,
    });
    expect(pdfMergeRow).toHaveTextContent("pdf-lib");
    expect(pdfMergeRow).toHaveTextContent("MIT");
  });
});
