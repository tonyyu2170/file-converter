// src/engines/archive-extract/options.test.ts
import { describe, expect, it } from "vitest";
import { defaultArchiveExtractOptions } from "./options";

describe("ArchiveExtractOptions", () => {
  it("default is an empty object", () => {
    expect(defaultArchiveExtractOptions).toEqual({});
  });
});
