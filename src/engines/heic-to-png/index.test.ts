import { describe, expect, it } from "vitest";
import engine from "./index";

describe("heic-to-png engine metadata", () => {
  it("declares correct id, mime types, and cardinality", () => {
    expect(engine.id).toBe("heic-to-png");
    expect(engine.inputAccept).toEqual([".heic", ".heif"]);
    expect(engine.inputMime).toEqual(["image/heic", "image/heif"]);
    expect(engine.outputMime).toBe("image/png");
    expect(engine.cardinality).toBe("single");
  });

  it("validates HEIC files by name", () => {
    const f = new File([new Uint8Array([1])], "vacation.heic", { type: "" });
    expect(engine.validate(f, {})).toEqual({ ok: true });
  });

  it("rejects non-HEIC files", () => {
    const f = new File([new Uint8Array([1])], "vacation.jpg", {
      type: "image/jpeg",
    });
    const r = engine.validate(f, {});
    expect(r.ok).toBe(false);
  });
});
