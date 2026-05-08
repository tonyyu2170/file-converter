import { describe, expect, it } from "vitest";
import { defaultImageToTextOptions, outputExtensionFor, outputMimeFor } from "./options";

describe("defaultImageToTextOptions", () => {
  it("defaults to txt format", () => {
    expect(defaultImageToTextOptions.outputFormat).toBe("txt");
  });
});

describe("outputExtensionFor", () => {
  it("returns txt for txt format", () => {
    expect(outputExtensionFor({ outputFormat: "txt" })).toBe("txt");
  });

  it("returns json for json-with-bboxes format", () => {
    expect(outputExtensionFor({ outputFormat: "json-with-bboxes" })).toBe("json");
  });
});

describe("outputMimeFor", () => {
  it("returns text/plain for txt format", () => {
    expect(outputMimeFor({ outputFormat: "txt" })).toBe("text/plain");
  });

  it("returns application/json for json-with-bboxes format", () => {
    expect(outputMimeFor({ outputFormat: "json-with-bboxes" })).toBe("application/json");
  });
});
