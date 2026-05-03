"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine from "@/engines/pdf-to-image";

export default function PdfToImagePage() {
  return <ToolFrame engine={engine} />;
}
