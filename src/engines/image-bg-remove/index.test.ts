import { describe, expect, it } from "vitest";
import engine from "./index";

describe("image-bg-remove engine metadata", () => {
  it("declares correct id, cardinality, category", () => {
    expect(engine.id).toBe("image-bg-remove");
    expect(engine.cardinality).toBe("single");
    expect(engine.category).toBe("image");
    expect(engine.outputMime).toBe("image/png");
  });

  it("inputAccept covers png/jpg/jpeg/webp", () => {
    expect(engine.inputAccept).toEqual([".png", ".jpg", ".jpeg", ".webp"]);
  });

  it("validate accepts supported MIMEs", () => {
    expect(
      engine.validate(
        new File([new Uint8Array(1)], "a.png", { type: "image/png" }),
        engine.defaultOptions,
      ),
    ).toEqual({ ok: true });
    expect(
      engine.validate(
        new File([new Uint8Array(1)], "a.jpg", { type: "image/jpeg" }),
        engine.defaultOptions,
      ),
    ).toEqual({ ok: true });
    expect(
      engine.validate(
        new File([new Uint8Array(1)], "a.webp", { type: "image/webp" }),
        engine.defaultOptions,
      ),
    ).toEqual({ ok: true });
  });

  it("validate accepts extension-only fallback", () => {
    expect(
      engine.validate(new File([new Uint8Array(1)], "a.png", { type: "" }), engine.defaultOptions),
    ).toEqual({ ok: true });
  });

  it("validate rejects unsupported types", () => {
    const v = engine.validate(
      new File([new Uint8Array(1)], "a.gif", { type: "image/gif" }),
      engine.defaultOptions,
    );
    expect(v.ok).toBe(false);
  });

  it("validate rejects files larger than 25 MB", () => {
    // Construct a File whose .size is reported as 26 MB without allocating
    // unnecessary memory: write a Blob with a known size and assert it's
    // rejected.
    const big = new File([new Uint8Array(26_000_000)], "big.png", {
      type: "image/png",
    });
    const v = engine.validate(big, engine.defaultOptions);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/25 MB/);
  });

  it("validate prefers MIME/extension error over size for unsupported formats", () => {
    // A 30 MB GIF should fail with the format error (the actionable one),
    // not the size error. SIMD probe stays first; MIME/extension check
    // runs before the size cap.
    const bigGif = new File([new Uint8Array(30_000_000)], "big.gif", {
      type: "image/gif",
    });
    const v = engine.validate(bigGif, engine.defaultOptions);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/PNG, JPEG, or WebP/);
  });
});
