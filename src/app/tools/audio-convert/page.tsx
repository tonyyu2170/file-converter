"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine, { disposeAudioConvertHarness } from "@/engines/audio-convert";
import { useEffect } from "react";

export default function AudioConvertPage() {
  useEffect(() => {
    return () => disposeAudioConvertHarness();
  }, []);

  return <ToolFrame engine={engine} />;
}
