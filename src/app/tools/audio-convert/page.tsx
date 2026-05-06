"use client";

import { useEffect } from "react";
import { ToolFrame } from "@/components/tool-frame";
import engine, { disposeAudioConvertHarness } from "@/engines/audio-convert";

export default function AudioConvertPage() {
  useEffect(() => {
    return () => disposeAudioConvertHarness();
  }, []);

  return <ToolFrame engine={engine} />;
}
