"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine from "@/engines/heic-to-png";

export default function HeicToPngPage() {
  return <ToolFrame engine={engine} />;
}
