import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "./page";

describe("Home", () => {
  it("renders the hero headline", () => {
    render(<Home />);
    expect(
      screen.getByRole("heading", { level: 1, name: "// CONVERT FILES. LOCALLY." }),
    ).toBeInTheDocument();
  });

  it("renders the privacy claim", () => {
    render(<Home />);
    expect(screen.getByText(/files never leave your device/i)).toBeInTheDocument();
  });

  it.each([
    {
      testid: "tool-card-image-convert",
      title: "image convert",
      description: "heic, png, jpg, webp · convert between formats",
      href: "/tools/image-convert",
    },
    {
      testid: "tool-card-image-to-pdf",
      title: "image→pdf",
      description: "combine multiple images into a single pdf",
      href: "/tools/image-to-pdf",
    },
    {
      testid: "tool-card-pdf-merge",
      title: "merge",
      description: "combine multiple pdfs into one",
      href: "/tools/pdf-merge",
    },
    {
      testid: "tool-card-pdf-split",
      title: "split",
      description: "extract page ranges from a pdf",
      href: "/tools/pdf-split",
    },
  ])(
    "renders tool card $testid with title, description, and href",
    ({ testid, title, description, href }) => {
      render(<Home />);
      const card = screen.getByTestId(testid);
      expect(card).toHaveAttribute("href", href);
      expect(card).toHaveTextContent(title);
      expect(card).toHaveTextContent(description);
    },
  );

  it("renders exactly 4 tool cards", () => {
    render(<Home />);
    const cards = screen.getAllByTestId(/^tool-card-/);
    expect(cards).toHaveLength(4);
  });
});
