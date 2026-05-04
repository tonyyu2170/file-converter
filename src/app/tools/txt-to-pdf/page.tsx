"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine from "@/engines/txt-to-pdf";

export default function TxtToPdfPage() {
  return <ToolFrame engine={engine} />;
}
