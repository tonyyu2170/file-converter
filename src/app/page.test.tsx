import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "./page";

describe("Home", () => {
  it("renders the status bar with version and tool count", () => {
    render(<Home />);
    const bar = screen.getByTestId("status-bar");
    expect(bar).toHaveTextContent("v0.1.0");
    expect(bar).toHaveTextContent("4 TOOLS ONLINE");
  });

  it("renders the hero headline as four colored spans", () => {
    render(<Home />);
    const headline = screen.getByTestId("hero-headline");
    expect(headline.tagName).toBe("H1");
    expect(headline).toHaveTextContent("convert files");
    expect(headline).toHaveTextContent("without");
    expect(headline).toHaveTextContent("uploading");
    expect(headline).toHaveTextContent("them.");
  });

  it("renders the privacy claim with the new mechanism copy", () => {
    render(<Home />);
    expect(screen.getByText(/files never leave your device/i)).toBeInTheDocument();
    expect(screen.getByText(/web workers running on your machine/i)).toBeInTheDocument();
  });

  it("renders the terminal prompt directing to the tool grid", () => {
    render(<Home />);
    const prompt = screen.getByTestId("terminal-prompt");
    expect(prompt).toHaveTextContent(/pick a tool below/i);
    expect(prompt).toHaveTextContent("$");
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
