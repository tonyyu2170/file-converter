"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine from "@/engines/docx-to-txt";

export default function DocxToTxtPage() {
  return <ToolFrame engine={engine} />;
}
