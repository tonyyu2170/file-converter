import { describe, expect, it } from "vitest";
import engine from "./index";

describe("image-convert engine metadata", () => {
  it("declares correct id, accept lists, and cardinality", () => {
    expect(engine.id).toBe("image-convert");
    expect(engine.inputAccept).toEqual([".heic", ".heif", ".png", ".jpg", ".jpeg", ".webp"]);
    expect(engine.inputMime).toEqual([
      "image/heic",
      "image/heif",
      "image/png",
      "image/jpeg",
      "image/webp",
    ]);
    expect(engine.cardinality).toBe("single");
  });

  it("declares an OptionsPanel component", () => {
    expect(engine.OptionsPanel).toBeDefined();
  });

  it("isReadyToConvert returns false when output is null", () => {
    expect(engine.isReadyToConvert?.({ output: null, quality: 0.9 })).toBe(false);
  });

  it("isReadyToConvert returns true when output is set", () => {
    expect(engine.isReadyToConvert?.({ output: "jpeg", quality: 0.9 })).toBe(true);
  });

  it("validates HEIC / HEIF / PNG / JPEG / WebP files by their type", () => {
    const heic = new File([new Uint8Array([1])], "z.heic", { type: "image/heic" });
    const heif = new File([new Uint8Array([1])], "y.heif", { type: "image/heif" });
    const png = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
    const jpg = new File([new Uint8Array([1])], "b.jpg", { type: "image/jpeg" });
    const webp = new File([new Uint8Array([1])], "c.webp", { type: "image/webp" });
    const opts = { output: null, quality: 0.9 };
    expect(engine.validate(heic, opts)).toEqual({ ok: true });
    expect(engine.validate(heif, opts)).toEqual({ ok: true });
    expect(engine.validate(png, opts)).toEqual({ ok: true });
    expect(engine.validate(jpg, opts)).toEqual({ ok: true });
    expect(engine.validate(webp, opts)).toEqual({ ok: true });
  });

  it("rejects non-image files", () => {
    const f = new File([new Uint8Array([1])], "x.txt", { type: "text/plain" });
    const r = engine.validate(f, { output: null, quality: 0.9 });
    expect(r.ok).toBe(false);
  });
});
