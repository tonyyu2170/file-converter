"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine from "@/engines/image-resize";

export default function ImageResizePage() {
  return <ToolFrame engine={engine} />;
}
