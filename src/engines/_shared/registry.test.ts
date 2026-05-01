import { describe, expect, it } from "vitest";
import { listEngineIds, loadEngine } from "./registry";

describe("registry", () => {
  it("lists engine ids including heic-to-png", () => {
    expect(listEngineIds()).toContain("heic-to-png");
  });

  it("loadEngine throws for unknown id", async () => {
    await expect(loadEngine("does-not-exist" as never)).rejects.toThrow("Unknown engine id");
  });
});
