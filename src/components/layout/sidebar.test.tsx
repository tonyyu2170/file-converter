import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Sidebar } from "./sidebar";

describe("Sidebar", () => {
  it("renders a HOME group with a link to /", () => {
    render(<Sidebar />);
    expect(screen.getByTestId("sidebar-home-link")).toHaveAttribute("href", "/");
    expect(screen.getByText("// HOME")).toBeInTheDocument();
  });

  it("renders all four new Phase 15 tool links in their groups", () => {
    render(<Sidebar />);
    expect(screen.getByRole("link", { name: /image resize/i })).toHaveAttribute(
      "href",
      "/tools/image-resize",
    );
    expect(screen.getByRole("link", { name: /docx→txt/i })).toHaveAttribute(
      "href",
      "/tools/docx-to-txt",
    );
    expect(screen.getByRole("link", { name: /markdown→pdf/i })).toHaveAttribute(
      "href",
      "/tools/markdown-to-pdf",
    );
    expect(screen.getByRole("link", { name: /txt→pdf/i })).toHaveAttribute(
      "href",
      "/tools/txt-to-pdf",
    );
  });

  it("renders the image-bg-remove link in the IMAGES group", () => {
    render(<Sidebar />);
    expect(screen.getByRole("link", { name: /image bg remove/i })).toHaveAttribute(
      "href",
      "/tools/image-bg-remove",
    );
  });

  it("renders an ABOUT group with a link to /about", () => {
    render(<Sidebar />);
    expect(screen.getByText("// ABOUT")).toBeInTheDocument();
    const aboutLink = screen.getByRole("link", { name: /^about$/ });
    expect(aboutLink).toHaveAttribute("href", "/about");
  });

  it("renders the audio-convert link in the AUDIO group", () => {
    render(<Sidebar />);
    expect(screen.getByText("// AUDIO")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /audio convert/i })).toHaveAttribute(
      "href",
      "/tools/audio-convert",
    );
  });

  it("renders the video-convert link in the VIDEO group", () => {
    render(<Sidebar />);
    expect(screen.getByText("// VIDEO")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /video convert/i })).toHaveAttribute(
      "href",
      "/tools/video-convert",
    );
  });
});
