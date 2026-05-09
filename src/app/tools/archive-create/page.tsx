"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine from "@/engines/archive-create";

export default function ArchiveCreatePage() {
  return <ToolFrame engine={engine} />;
}
