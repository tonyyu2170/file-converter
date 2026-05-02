import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Header } from "./header";

describe("Header", () => {
  it("renders the logo as a link to /", () => {
    render(<Header />);
    expect(screen.getByTestId("header-home-link")).toHaveAttribute("href", "/");
  });
});
