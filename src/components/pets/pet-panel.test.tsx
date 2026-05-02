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

  it("renders a <picture> with a reduced-motion <source> for the static png", () => {
    const { container } = render(<PetPanel />);
    const picture = container.querySelector("picture");
    expect(picture).not.toBeNull();
    const source = picture?.querySelector("source");
    expect(source).not.toBeNull();
    expect(source).toHaveAttribute("srcset", "/pets/akita_static.png");
    expect(source).toHaveAttribute("media", "(prefers-reduced-motion: reduce)");
  });

  it("renders the animated gif <img> with decorative alt and pet-stroll class", () => {
    const { container } = render(<PetPanel />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", "/pets/akita_walk_8fps.gif");
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("width", "87");
    expect(img).toHaveAttribute("height", "57");
    expect(img?.className).toContain("pet-stroll");
  });
});
