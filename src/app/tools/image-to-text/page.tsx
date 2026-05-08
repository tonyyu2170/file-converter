"use client";

import { ToolFrame } from "@/components/tool-frame";
import engine, { disposeImageToTextHarness } from "@/engines/image-to-text";
import { useEffect } from "react";

export default function ImageToTextPage() {
  useEffect(() => {
    return () => {
      disposeImageToTextHarness();
    };
  }, []);

  return <ToolFrame engine={engine} />;
}
