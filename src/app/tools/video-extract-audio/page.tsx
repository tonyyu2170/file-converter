"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine, { disposeVideoExtractAudioHarness } from "@/engines/video-extract-audio";
import { useEffect } from "react";

export default function VideoExtractAudioPage() {
  useEffect(() => {
    return () => disposeVideoExtractAudioHarness();
  }, []);

  return <ToolFrame engine={engine} />;
}
