#!/usr/bin/env node
// Generates tests/fixtures/pdf-edit/multi-page.pdf — a 5-page PDF
// with mixed orientations and an existing 90° rotation on page 3
// so the rotation-composition path in pdf-edit/worker.ts is testable.
//
// Run: node scripts/generate-pdf-edit-fixture.mjs
// Idempotent — overwrites the output each time.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

const OUT_DIR = path.resolve("tests/fixtures/pdf-edit");
const OUT_PATH = path.join(OUT_DIR, "multi-page.pdf");

async function main() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const pages = [
    { w: 612, h: 792, rotate: 0,   label: "PAGE 1 PORTRAIT" },
    { w: 792, h: 612, rotate: 0,   label: "PAGE 2 LANDSCAPE" },
    { w: 612, h: 792, rotate: 90,  label: "PAGE 3 PORTRAIT pre-rotated 90" },
    { w: 612, h: 792, rotate: 0,   label: "PAGE 4 PORTRAIT" },
    { w: 792, h: 612, rotate: 0,   label: "PAGE 5 LANDSCAPE" },
  ];

  for (const p of pages) {
    const page = doc.addPage([p.w, p.h]);
    if (p.rotate !== 0) page.setRotation(degrees(p.rotate));
    page.drawText(p.label, {
      x: 50,
      y: p.h - 100,
      size: 24,
      font,
      color: rgb(0, 0, 0),
    });
  }

  const bytes = await doc.save();
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_PATH, bytes);
  console.log(`wrote ${OUT_PATH} (${bytes.byteLength} bytes, ${pages.length} pages)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
