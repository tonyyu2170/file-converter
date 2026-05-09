// src/engines/xml-to-json/options.test.ts
import { describe, expect, it } from "vitest";
import { defaultXmlToJsonOptions } from "./options";

describe("XmlToJsonOptions", () => {
  it("defaults attributePrefix to @", () => {
    expect(defaultXmlToJsonOptions.attributePrefix).toBe("@");
  });
});
