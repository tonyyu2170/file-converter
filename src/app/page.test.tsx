import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "./page";

describe("Home", () => {
  it("renders the status bar with version and tool count", () => {
    render(<Home />);
    const bar = screen.getByTestId("status-bar");
    expect(bar).toHaveTextContent("v1.0.0");
    expect(bar).toHaveTextContent("23 TOOLS ONLINE");
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
    {
      testid: "tool-card-pdf-to-image",
      title: "pdf → image",
      description: "render each page as png or jpeg",
      href: "/tools/pdf-to-image",
    },
    {
      testid: "tool-card-pdf-to-md",
      title: "pdf → md",
      description: "extract markdown from a pdf (heuristic)",
      href: "/tools/pdf-to-md",
    },
    {
      testid: "tool-card-docx-to-pdf",
      title: "docx → pdf",
      description: "render word documents as pdfs",
      href: "/tools/docx-to-pdf",
    },
    {
      testid: "tool-card-image-resize",
      title: "image resize",
      description: "png, jpg, jpeg, webp, heic · resize by px or %",
      href: "/tools/image-resize",
    },
    {
      testid: "tool-card-image-bg-remove",
      title: "image bg remove",
      description: "png, jpg, webp · cutout to transparent or solid color",
      href: "/tools/image-bg-remove",
    },
    {
      testid: "tool-card-docx-to-txt",
      title: "docx → txt",
      description: "extract plain text from word documents",
      href: "/tools/docx-to-txt",
    },
    {
      testid: "tool-card-markdown-to-pdf",
      title: "markdown → pdf",
      description: "render markdown as a styled pdf",
      href: "/tools/markdown-to-pdf",
    },
    {
      testid: "tool-card-txt-to-pdf",
      title: "txt → pdf",
      description: "render text verbatim as a monospace pdf",
      href: "/tools/txt-to-pdf",
    },
    {
      testid: "tool-card-audio-trim",
      title: "audio trim",
      description: "mp3, wav, m4a, flac · trim to a sub-range, lossless when format unchanged",
      href: "/tools/audio-trim",
    },
    {
      testid: "tool-card-video-trim",
      title: "video trim",
      description: "mp4, mov, webm, mkv · trim to a sub-range, lossless via -c copy",
      href: "/tools/video-trim",
    },
    {
      testid: "tool-card-video-extract-audio",
      title: "video → audio",
      description: "mp4, mov, webm, mkv · pull the audio track, lossless when possible",
      href: "/tools/video-extract-audio",
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

  it("renders exactly 23 tool cards", () => {
    render(<Home />);
    const cards = screen.getAllByTestId(/^tool-card-/);
    expect(cards).toHaveLength(23);
  });

  it("renders the pet panel inside the hero", () => {
    render(<Home />);
    expect(screen.getByTestId("pet-panel")).toBeInTheDocument();
  });
});
