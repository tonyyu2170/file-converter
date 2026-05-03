"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine from "@/engines/pdf-to-md";

export default function PdfToMdPage() {
  return <ToolFrame engine={engine} />;
}
