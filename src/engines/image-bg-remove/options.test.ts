import { describe, expect, it } from "vitest";
import { HEX_PATTERN, clampOptions, defaultImageBgRemoveOptions } from "./options";

describe("clampOptions", () => {
  it("forces outputFormat to png when bgMode is transparent", () => {
    const r = clampOptions({
      bgMode: "transparent",
      bgColor: "#ffffff",
      outputFormat: "jpeg",
      jpegQuality: 0.9,
    });
    expect(r.outputFormat).toBe("png");
  });
  it("leaves solid + jpeg alone", () => {
    const inp = {
      bgMode: "solid",
      bgColor: "#000000",
      outputFormat: "jpeg",
      jpegQuality: 0.8,
    } as const;
    expect(clampOptions(inp)).toEqual(inp);
  });
});

describe("defaults", () => {
  it("starts on transparent + png", () => {
    expect(defaultImageBgRemoveOptions.bgMode).toBe("transparent");
    expect(defaultImageBgRemoveOptions.outputFormat).toBe("png");
  });
});

describe("HEX_PATTERN", () => {
  it.each(["#ffffff", "#000000", "#A3F1c9"])("accepts %s", (s) => {
    expect(HEX_PATTERN.test(s)).toBe(true);
  });
  it.each(["fff", "#fff", "#xyzxyz", "#1234567"])("rejects %s", (s) => {
    expect(HEX_PATTERN.test(s)).toBe(false);
  });
});
