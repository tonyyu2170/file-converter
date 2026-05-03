"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine from "@/engines/docx-to-pdf";

export default function DocxToPdfPage() {
  return <ToolFrame engine={engine} />;
}
