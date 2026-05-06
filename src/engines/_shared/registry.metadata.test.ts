import { describe, expect, it } from "vitest";
import { listEngineIds, loadEngine } from "./registry";

describe("every registered engine declares library + license", () => {
  for (const id of listEngineIds()) {
    it(`${id} has library + license`, async () => {
      const engine = await loadEngine(id);
      expect(engine.library, `${id}.library`).toBeTypeOf("string");
      expect((engine.library as string).length).toBeGreaterThan(0);
      expect(engine.license, `${id}.license`).toMatch(/^(MIT|Apache-2\.0|BSD-3-Clause|ISC|GPL-2\.0-or-later|mixed)$/);
    });
  }
});
