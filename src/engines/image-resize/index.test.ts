import { describe, expect, it } from "vitest";
import engine from "./index";

describe("image-resize engine metadata", () => {
  it("declares correct id, accept lists, cardinality, category", () => {
    expect(engine.id).toBe("image-resize");
    expect(engine.inputAccept).toEqual([".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif"]);
    expect(engine.inputMime).toEqual([
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/heic",
      "image/heif",
    ]);
    expect(engine.outputMime).toBe("image/png"); // declarative default
    expect(engine.cardinality).toBe("single");
    expect(engine.category).toBe("image");
    expect(engine.defaultOptions).toEqual({
      width: 1920,
      height: 1080,
      mode: "px",
      lockAspectRatio: true,
    });
  });

  it("declares an OptionsPanel component", () => {
    expect(engine.OptionsPanel).toBeDefined();
  });

  it("validates supported image MIMEs", () => {
    const png = new File([new Uint8Array(0)], "x.png", { type: "image/png" });
    const txt = new File([new Uint8Array(0)], "x.txt", { type: "text/plain" });
    expect(engine.validate(png, engine.defaultOptions)).toEqual({ ok: true });
    const result = engine.validate(txt, engine.defaultOptions);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/png|jpeg|webp|heic/i);
  });

  it("validates by extension when MIME is empty (Safari HEIC)", () => {
    const heicNoMime = new File([new Uint8Array(0)], "photo.heic", { type: "" });
    const jpegNoMime = new File([new Uint8Array(0)], "art.jpeg", { type: "" });
    expect(engine.validate(heicNoMime, engine.defaultOptions)).toEqual({ ok: true });
    expect(engine.validate(jpegNoMime, engine.defaultOptions)).toEqual({ ok: true });
  });
});
