import { describe, expect, it } from "vitest";
import engine from "./index";

describe("image-to-pdf engine metadata", () => {
  it("declares correct id, accept lists, and cardinality", () => {
    expect(engine.id).toBe("image-to-pdf");
    expect(engine.inputAccept).toEqual([".heic", ".heif", ".png", ".jpg", ".jpeg", ".webp"]);
    expect(engine.inputMime).toEqual([
      "image/heic",
      "image/heif",
      "image/png",
      "image/jpeg",
      "image/webp",
    ]);
    expect(engine.cardinality).toBe("multi");
    expect(engine.outputMime).toBe("application/pdf");
  });

  it("declares both OptionsPanel and StagingArea components", () => {
    expect(engine.OptionsPanel).toBeDefined();
    expect(engine.StagingArea).toBeDefined();
  });

  it("rejects an empty file list", async () => {
    const r = await engine.validate([], engine.defaultOptions);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/at least one/i);
  });

  it("accepts a single supported image", async () => {
    const f = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
    const r = await engine.validate([f], engine.defaultOptions);
    expect(r.ok).toBe(true);
  });

  it("accepts a mixed-format set", async () => {
    const heic = new File([new Uint8Array([1])], "z.heic", { type: "image/heic" });
    const png = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
    const jpg = new File([new Uint8Array([1])], "b.jpg", { type: "image/jpeg" });
    const webp = new File([new Uint8Array([1])], "c.webp", { type: "image/webp" });
    const r = await engine.validate([heic, png, jpg, webp], engine.defaultOptions);
    expect(r.ok).toBe(true);
  });

  it("rejects a set containing one non-image", async () => {
    const png = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
    const txt = new File([new Uint8Array([1])], "b.txt", { type: "text/plain" });
    const r = await engine.validate([png, txt], engine.defaultOptions);
    expect(r.ok).toBe(false);
  });
});
