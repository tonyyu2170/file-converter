# Data fixtures

All hand-authored. Each fixture is < 1 KB. No build script required —
edit by hand if a fixture needs revision.

## Happy-path round-trip set

`sample.csv`, `sample.json`, `sample.yaml`, `sample.xml` all encode the
same logical data: an array of 4 records with fields `id`, `name`,
`score`. The XML version adds attributes for the round-trip-with-attrs
case. These are the "drop and convert" inputs for E2E happy paths.

## Tree → CSV rejection cases

- `nested.json` — array containing an object with a nested object value.
- `non-array.json` — top-level object (not array).
- `missing-key.json` — array where row 3 is missing a key the others have.

## YAML SAFE_SCHEMA rejection case

- `unsafe.yaml` — uses `!!js/function` tag. Should fail to load.

## json-format edge case

- `bom.json` — leading UTF-8 BOM (0xEF 0xBB 0xBF) followed by valid JSON.
  The engine should strip the BOM before `JSON.parse`.

## xml-to-json edge cases

- `mixed.xml` — mixed content (text and child elements interleaved).
  Documents fast-xml-parser's "best-effort" mixed-content handling.
- `namespaced.xml` — element with namespace prefix. Confirms namespace
  prefix preserved verbatim in JSON keys.
