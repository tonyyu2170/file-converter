"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine from "@/engines/xml-to-json";

export default function XmlToJsonPage() {
  return <ToolFrame engine={engine} />;
}
