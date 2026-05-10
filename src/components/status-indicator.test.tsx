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

  // Regression gate: the production CSP is `style-src 'self'`, so any inline
  // `style="..."` attribute on this component fails the CSP and drops the
  // Lighthouse Best Practices score on every /tools/* route. Color must come
  // from a className.
  it("never renders an inline style attribute (CSP regression gate)", () => {
    const all = ["ready", "converting", "done", "error", "fatal"] as const;
    for (const s of all) {
      const { unmount } = render(<StatusIndicator status={s} />);
      expect(screen.getByTestId("status-indicator")).not.toHaveAttribute("style");
      unmount();
    }
  });
});
