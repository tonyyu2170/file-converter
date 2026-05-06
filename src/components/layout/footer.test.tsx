import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Footer } from "./footer";

describe("Footer", () => {
  it("renders the conversion count and version", () => {
    render(<Footer count={3} version="v0.1.0" />);
    expect(screen.getByText(/3 conversions this session/)).toBeInTheDocument();
    expect(screen.getByText("v0.1.0")).toBeInTheDocument();
  });

  it("renders the akita attribution link to NVPH Studio", () => {
    render(<Footer count={0} version="v0.1.0" />);
    const link = screen.getByRole("link", { name: /akita by NVPH Studio/i });
    expect(link).toHaveAttribute(
      "href",
      "https://nvph-studio.itch.io/dog-animation-4-different-dogs",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("renders the CC BY-ND 4.0 license link", () => {
    render(<Footer count={0} version="v0.1.0" />);
    const link = screen.getByRole("link", { name: /CC BY-ND 4\.0/i });
    expect(link).toHaveAttribute("href", "https://creativecommons.org/licenses/by-nd/4.0/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("renders an /about link", () => {
    render(<Footer count={0} version="v0.1.0" />);
    const link = screen.getByRole("link", { name: /^about$/i });
    expect(link).toHaveAttribute("href", "/about");
  });
});
