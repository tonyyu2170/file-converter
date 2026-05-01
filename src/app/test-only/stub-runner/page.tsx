"use client";

import stubEngine from "@/engines/_stub";
import { useState } from "react";

export default function StubRunner() {
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [output, setOutput] = useState<string>("");

  async function runConversion() {
    try {
      setStatus("running");
      const file = new File([new Uint8Array(1024)], "synthetic.bin", {
        type: "application/octet-stream",
      });
      const ctrl = new AbortController();
      const result = await stubEngine.convert(file, {}, ctrl.signal);
      const item = Array.isArray(result) ? result[0] : result;
      if (!item) throw new Error("no output");
      setOutput(item.filename);
      setStatus("done");
    } catch (err) {
      setOutput(String(err));
      setStatus("error");
    }
  }

  return (
    <main className="p-4">
      <button type="button" data-testid="run" onClick={runConversion}>
        run stub conversion
      </button>
      <div data-testid="status">{status}</div>
      <div data-testid="output">{output}</div>
    </main>
  );
}
