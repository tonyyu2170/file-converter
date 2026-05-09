// src/engines/data-convert/options.test.ts
import { describe, expect, it } from "vitest";
import { defaultDataConvertOptions, extensionFor, mimeFor } from "./options";

describe("DataConvertOptions", () => {
  it("defaults to JSON output", () => {
    expect(defaultDataConvertOptions.outputFormat).toBe("json");
  });
  it("extensionFor maps each format", () => {
    expect(extensionFor("csv")).toBe("csv");
    expect(extensionFor("json")).toBe("json");
    expect(extensionFor("yaml")).toBe("yaml");
  });
  it("mimeFor maps each format", () => {
    expect(mimeFor("csv")).toBe("text/csv");
    expect(mimeFor("json")).toBe("application/json");
    expect(mimeFor("yaml")).toBe("application/yaml");
  });
});
