"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine from "@/engines/pdf-merge";

export default function PdfMergePage() {
  return <ToolFrame engine={engine} />;
}
