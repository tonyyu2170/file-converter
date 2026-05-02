import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PetPanel } from "./pet-panel";

describe("PetPanel", () => {
  it("renders the panel with decorative aria-hidden marker", () => {
    render(<PetPanel />);
    const panel = screen.getByTestId("pet-panel");
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveAttribute("aria-hidden", "true");
  });

  it("renders both pets simultaneously", () => {
    render(<PetPanel />);
    expect(screen.getByTestId("pet-walk")).toBeInTheDocument();
    expect(screen.getByTestId("pet-ball")).toBeInTheDocument();
  });

  it("renders the walk pet with the walk gif and pet-stroll class", () => {
    render(<PetPanel />);
    const img = screen.getByTestId("pet-walk");
    expect(img).toHaveAttribute("src", "/pets/akita_walk_8fps.gif");
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("width", "87");
    expect(img).toHaveAttribute("height", "57");
    expect(img.className).toContain("pet-stroll");
    expect(img.className).not.toContain("pet-stroll-reverse");
  });

  it("renders the ball pet with the with-ball gif and pet-stroll-reverse class", () => {
    render(<PetPanel />);
    const img = screen.getByTestId("pet-ball");
    expect(img).toHaveAttribute("src", "/pets/akita_with_ball_8fps.gif");
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("width", "87");
    expect(img).toHaveAttribute("height", "57");
    expect(img.className).toContain("pet-stroll-reverse");
  });

  it("renders a reduced-motion <source> for each pet", () => {
    const { container } = render(<PetPanel />);
    const sources = container.querySelectorAll("picture > source");
    expect(sources).toHaveLength(2);
    const srcsets = Array.from(sources).map((s) => s.getAttribute("srcset"));
    expect(srcsets).toContain("/pets/akita_static.png");
    expect(srcsets).toContain("/pets/akita_with_ball_static.png");
    for (const source of sources) {
      expect(source).toHaveAttribute("media", "(prefers-reduced-motion: reduce)");
    }
  });
});
