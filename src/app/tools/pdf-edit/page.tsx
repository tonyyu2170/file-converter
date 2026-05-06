"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine from "@/engines/pdf-edit";

export default function PdfEditPage() {
  return <ToolFrame engine={engine} />;
}
