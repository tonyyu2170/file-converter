"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine from "@/engines/archive-extract";

export default function ArchiveExtractPage() {
  return <ToolFrame engine={engine} />;
}
