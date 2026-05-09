"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine from "@/engines/json-format";

export default function JsonFormatPage() {
  return <ToolFrame engine={engine} />;
}
