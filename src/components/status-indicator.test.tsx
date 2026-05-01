import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusIndicator } from "./status-indicator";

describe("StatusIndicator", () => {
  it("renders the READY label by default-style status", () => {
    render(<StatusIndicator status="ready" />);
    expect(screen.getByTestId("status-indicator")).toHaveTextContent("[ READY ]");
  });

  it("renders all distinct statuses with bracketed all-caps labels", () => {
    const all = ["ready", "converting", "done", "error", "fatal"] as const;
    for (const s of all) {
      const { unmount } = render(<StatusIndicator status={s} />);
      expect(screen.getByTestId("status-indicator").textContent).toMatch(/^\[ [A-Z]+ \]$/);
      unmount();
    }
  });

  it("uses aria-live polite for screen readers", () => {
    render(<StatusIndicator status="converting" />);
    expect(screen.getByTestId("status-indicator")).toHaveAttribute("aria-live", "polite");
  });
});
