import { describe, expect, it } from "vitest";

describe("test runner sanity", () => {
  it("multiplies", () => {
    expect(2 * 21).toBe(42);
  });

  it("loads jest-dom matchers", () => {
    const el = document.createElement("div");
    el.textContent = "hello";
    document.body.appendChild(el);
    expect(el).toBeInTheDocument();
    expect(el).toHaveTextContent("hello");
    document.body.removeChild(el);
  });
});
