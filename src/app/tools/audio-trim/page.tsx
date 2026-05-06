"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine, { disposeAudioTrimHarness } from "@/engines/audio-trim";
import { useEffect } from "react";

export default function AudioTrimPage() {
  useEffect(() => {
    return () => disposeAudioTrimHarness();
  }, []);

  return <ToolFrame engine={engine} />;
}
