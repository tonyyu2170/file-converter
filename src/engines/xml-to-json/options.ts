// src/engines/xml-to-json/options.ts
export type XmlToJsonAttributePrefix = "@" | "$_" | "";

export type XmlToJsonOptions = {
  attributePrefix: XmlToJsonAttributePrefix;
};

export const defaultXmlToJsonOptions: XmlToJsonOptions = {
  attributePrefix: "@",
};
