"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine from "@/engines/video-convert";

export default function VideoConvertPage() {
  return <ToolFrame engine={engine} />;
}
