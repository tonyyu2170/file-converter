"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine, { disposeVideoTrimHarness } from "@/engines/video-trim";
import { useEffect } from "react";

export default function VideoTrimPage() {
  useEffect(() => {
    return () => disposeVideoTrimHarness();
  }, []);

  return <ToolFrame engine={engine} />;
}
