// tesseract.js uses `export = Tesseract; export as namespace Tesseract` (CJS
// namespace export). Named re-exports require the namespace form under the
// project's moduleResolution settings.
import type Tesseract from "tesseract.js";

/** Re-exported under a stable alias so Task 3 (worker.ts) callers do not
 *  need to know the tesseract.js namespace shape. */
export type TesseractWorker = Tesseract.Worker;

export type WordBbox = {
  text: string;
  confidence: number;
  x: number;
  y: number;
  w: number;
  h: number;
};
