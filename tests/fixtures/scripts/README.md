# PDF fixture generation

## Healthy fixtures (script)

Run from the repo root:

```bash
node tests/fixtures/scripts/generate-pdf-fixtures.mjs
```

This regenerates `sample-1page.pdf`, `sample-2page.pdf`, `sample-5page.pdf`.
Re-run after pdf-lib upgrades to pick up any byte-level format changes.

## Encrypted fixture (manual)

`sample-encrypted.pdf` is a password-protected PDF used by Plan 4's
encrypted-PDF rejection E2E test. pdf-lib does not write encrypted
PDFs in v1.17, so this fixture is generated externally and committed.

To regenerate:

```bash
# Option A: qpdf (cross-platform, available via brew/apt)
qpdf --encrypt user-password owner-password 256 -- \
  tests/fixtures/sample-1page.pdf tests/fixtures/sample-encrypted.pdf

# Option B: macOS Preview
# Open sample-1page.pdf → File → Export → check "Encrypt" → set password "user"
# → Save As tests/fixtures/sample-encrypted.pdf
```

The user/owner passwords don't matter for the test — the test only
asserts that pdf-lib's PDFDocument.load throws EncryptedPDFError on
this file.
