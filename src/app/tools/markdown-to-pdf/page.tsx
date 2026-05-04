"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine from "@/engines/markdown-to-pdf";

export default function MarkdownToPdfPage() {
  return <ToolFrame engine={engine} />;
}
