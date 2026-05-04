/**
 * Relocation guard: verifies that `parseDocx` is correctly re-exported
 * from `_shared/docx` and can parse a real DOCX fixture end-to-end.
 *
 * If this test breaks after a refactor, the parser is no longer reachable
 * from the shared entry point — fix `_shared/docx/index.ts`, not this test.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseDocx } from "./index";

const FIXTURES_DIR = join(process.cwd(), "tests", "fixtures");

describe("_shared/docx parseDocx re-export", () => {
  it("re-exports parseDocx and parses a known DOCX fixture", () => {
    const bytes = new Uint8Array(readFileSync(join(FIXTURES_DIR, "simple-paragraphs.docx")));
    const result = parseDocx(bytes);
    expect(result).toBeDefined();
    expect(result.sections).toBeInstanceOf(Array);
    expect(result.sections.length).toBeGreaterThan(0);
    // Each section must have a blocks array
    for (const section of result.sections) {
      expect(section.blocks).toBeInstanceOf(Array);
    }
  });
});
