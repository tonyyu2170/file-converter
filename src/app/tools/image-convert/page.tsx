"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine from "@/engines/image-convert";

export default function ImageConvertPage() {
  return <ToolFrame engine={engine} />;
}
