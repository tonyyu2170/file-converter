"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine from "@/engines/pdf-split";

export default function PdfSplitPage() {
  return <ToolFrame engine={engine} />;
}
