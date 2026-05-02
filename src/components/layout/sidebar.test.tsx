import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Sidebar } from "./sidebar";

describe("Sidebar", () => {
  it("renders a HOME group with a link to /", () => {
    render(<Sidebar />);
    expect(screen.getByTestId("sidebar-home-link")).toHaveAttribute("href", "/");
    expect(screen.getByText("// HOME")).toBeInTheDocument();
  });
});
