"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine from "@/engines/data-convert";

export default function DataConvertPage() {
  return <ToolFrame engine={engine} />;
}
