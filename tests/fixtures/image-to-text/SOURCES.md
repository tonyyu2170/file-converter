# image-to-text fixtures — sources

All four fixtures are < 1 MB per CLAUDE.md committed-fixture rule.

## scanned-receipt.png
Synthesized via ImageMagick. Substring assertion: "TOTAL" + "$".

## screenshot.png
Synthesized via ImageMagick (faux editor). Substring assertion:
"recognizeText".

## photo-with-text.jpg
Synthesized via ImageMagick (degraded-photo approximation).
Substring assertion: "WELCOME".

## screenshot.heic
Re-encoded from screenshot.png via heif-enc. Substring assertion:
"recognizeText". Exercises the libheif reuse path
(_shared/decode-image.ts).

## Regeneration

See Phase 23 plan, Task 0 — exact commands captured there.

## Used by

- `src/engines/image-to-text/index.test.ts`
- `src/engines/_shared/tesseract/index.test.ts`
- `tests/e2e/image-to-text-correctness.spec.ts`
- `tests/e2e/privacy-regression-image-to-text.spec.ts`
