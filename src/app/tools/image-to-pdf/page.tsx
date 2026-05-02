"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine from "@/engines/image-to-pdf";

export default function ImageToPdfPage() {
  return <ToolFrame engine={engine} />;
}
