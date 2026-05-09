# Phase 25 — `data-convert` + `json-format` + `xml-to-json` engines

**Date:** 2026-05-08
**Status:** draft (pending approval)
**Source of truth:** `docs/superpowers/specs/2026-05-05-v2-design.md` §3.4 (Data), §4.1 (sidebar grouping), §5 (phasing — Phase 25), §6 (testing strategy), §7.1 (caps). Phase 24 (`2026-05-08-phase-24-archives-design.md`) established the per-phase design doc + sidebar-group-as-arrived convention this phase follows.

## 1. Goal

Ship the v2 Data family — three small text-tree engines, each single-input + single-output, all built on existing or near-existing libraries, all fast on the 50 MB cap:

1. `src/engines/data-convert/`: CSV ↔ JSON ↔ YAML interchange. JS-object intermediate. Tree → CSV requires shallow tabular shape.
2. `src/engines/json-format/`: JSON pretty / minify. Strict JSON only (no JSONC / trailing commas / comments).
3. `src/engines/xml-to-json/`: One-way XML → JSON. Configurable attribute prefix.

**Out of scope** (deferred per v2 spec §1.3 + new deferrals listed in §6 below): JSON → XML reconstruction, TOML, CSV delimiter override, YAML flow-style output, JSONC / JSON5 input, any multi-input data engine.

## 2. Resolved design decisions

### 2.1 Library stack — fast-xml-parser already; papaparse + js-yaml are new

| Concern | Library | Notes |
|---|---|---|
| CSV parse + stringify | `papaparse` ^5.x | New dep. ~45 KB min. MIT. Pure-browser, no Node deps. |
| YAML load + dump | `js-yaml` ^4.x | New dep. ~40 KB min. MIT. **Forced to `SAFE_SCHEMA`** on load — blocks `!!js/function`, `!!js/regexp`, and other JS-typed constructors. |
| JSON pretty / minify | native `JSON` | No dep. |
| XML → JSON | `fast-xml-parser` ^5.7.2 | Already installed (verified via `package.json`). MIT. |

**Net-new third-party deps for Phase 25: 2** (`papaparse`, `js-yaml`). Both lazy-loaded inside engine workers; bundle-isolation script enforces no homepage-chunk leak.

### 2.2 Category registration — `EngineCategory: "data"` and `SIZE_LIMITS_MB`

`src/engines/_shared/types.ts` extends `EngineCategory` from `... | "archive"` (Phase 24) to `... | "archive" | "data"`.

`src/engines/_shared/size-limits.ts` adds the exhaustive `data` entry:

```ts
// Data engines parse text trees into JS objects. 50 MB hard cap matches the
// per-engine constants below; soft cap (25 MB) sets the "may be slow"
// warning at the threshold where in-browser parsing of large text trees
// starts to feel sluggish on the 8 GB dev box.
data: { soft: 25, hard: 50 },
```

`SIZE_LIMITS_MB` test in `size-limits.test.ts` extends with the matching expectation + byte-conversion assertion (`softCapBytes("data") === 25_000_000`, `hardCapBytes("data") === 50_000_000`).

### 2.3 `data-convert` — pipeline, format detection, shape rules

**Cardinality:** `SingleInputEngine`. One file in, one file out.

**Format detection (input):**
1. Sniff first non-whitespace byte of input:
   - `[` or `{` → JSON.
   - `<` → reject with `"data-convert doesn't speak XML; use the xml-to-json engine"`.
2. Else use extension fallback: `.csv` → CSV; `.yaml` / `.yml` → YAML; `.json` → JSON.
3. Else reject: `"unrecognized format — supported: .csv, .json, .yaml, .yml"`.

Sniff wins over extension when both signal — handles common case of mislabelled files (`data.txt` containing JSON).

**OptionsPanel:**
- `outputFormat: "csv" | "json" | "yaml"` — segmented control. Default = JSON (most common interchange target).

No other knobs in v2.

**Pipeline:**
1. Parse input → JS-object intermediate (`unknown`-typed; no schema validation beyond format-specific structural checks).
2. **Same-format rejection.** If detected input format === outputFormat, reject: `` "input is already <format>; pick a different output (or use json-format for pretty/minify)" ``.
3. Validate intermediate against output's shape requirements (most relevant: tree → CSV requires shallow tabular).
4. Stringify intermediate in selected format.
5. Output: `<basename>.<ext>` with appropriate MIME (`text/csv`, `application/json`, `application/yaml`).

**Tree → CSV shape rules.** The intermediate must be a top-level array of flat objects:
- Top-level NOT an array → `"input is not a top-level array — JSON → CSV needs an array of objects (got <type>)"`.
- Any row contains a non-primitive value → `` "row N contains a nested <type> at key \"<key>\" — flatten or pick JSON / YAML output" ``.
- Rows have non-uniform shape (key missing in row N) → `` "row N is missing key \"<key>\" — JSON → CSV needs uniform shape across all rows" ``.

Header row derived from union of keys across all rows, preserving first-seen order.

**CSV → tree.** Assumes header row (per v2 spec). Empty cells become empty string `""` in output (NOT `null` — papaparse default; preserves CSV semantics that empty ≠ explicit null). Empty rows skipped silently.

**YAML schema.** `SAFE_SCHEMA` always. Any non-standard tag throws on load with the actionable message: `"YAML uses non-standard tag <tag>; this app loads YAML with SAFE_SCHEMA only"`.

**Engine descriptor:** `category: "data"`, `library: "papaparse, js-yaml"`, `license: "MIT"`. No `archiveSuffix`.

### 2.4 `json-format` — pretty / minify

**Cardinality:** `SingleInputEngine`. One file in, one file out.

**Validation.** Lenient: `.json` extension OR MIME `application/json`. Size cap 50 MB.

**OptionsPanel:**
- `mode: "pretty" | "minify"` — segmented control. Default = `"pretty"`.
- `indent: 2 | 4 | "tab"` — segmented control. Only shown when `mode === "pretty"`. Default = `2`.

**Pipeline:**
1. Strip leading UTF-8 BOM if present (some text editors add it; `JSON.parse` rejects it). Single-byte test before parsing.
2. `JSON.parse(text)` — strict JSON only. Parse errors propagate verbatim with one wrapping line: `"input is not valid JSON: <native message>"`.
3. `JSON.stringify(value, null, indentArg)` where `indentArg` is `0` for minify, `2` / `4` for numeric, `"\t"` for tab.
4. Output: `<basename>.json` with MIME `application/json`. **Filename unchanged from input** — operation rewrites the file in-place semantically.

**No same-format rejection.** Unlike `data-convert`, `json-format` honors the user's intent even when the output is byte-identical to the input — even confirming valid JSON is useful feedback.

**Edge cases:**
- Empty file → reject (`"input is empty"`).
- Whitespace-only file → reject (parse error from native JSON).
- Top-level non-object/non-array (e.g., `"hello"` or `42`) → accepted (valid JSON per RFC 8259 §3).

**Engine descriptor:** `category: "data"`, `library: "native JSON"`, `license: "MIT"`, `convertButtonLabel: "[ format json ]"`. No `archiveSuffix`.

### 2.5 `xml-to-json` — one-way XML → JSON

**Cardinality:** `SingleInputEngine`. One file in, one file out. **One-way** — JSON → XML reconstruction is deferred (per v2 spec §3.4).

**Validation.** Lenient: `.xml` extension OR MIME `application/xml` / `text/xml`. Size cap 50 MB.

**OptionsPanel:**
- `attributePrefix: "@" | "$_" | ""` — segmented control. Default = `"@"` (Badgerfish-inspired).

The prefix decision matters because XML elements can have both attributes and child elements with the same name, and JSON has no native attribute concept. With `attributePrefix = "@"`:

```xml
<book id="42"><title>X</title></book>
```

becomes:

```json
{"book": {"@id": "42", "title": "X"}}
```

**Pipeline:**
1. Configure `fast-xml-parser` with:
   - `attributeNamePrefix: opts.attributePrefix`
   - `ignoreAttributes: false`
   - `parseAttributeValue: false` (preserve as strings — JSON numeric coercion would lose `"007"`-style values)
   - `parseTagValue: false` (same reason for text content)
   - `trimValues: true`
2. Parse XML → JS object.
3. `JSON.stringify(parsed, null, 2)` — pretty by default. (No `indent` option in v2; users who want minified can pipe through `json-format`.)
4. Output: `<basename>.json` with MIME `application/json`.

**Edge cases:**
- Malformed XML → `fast-xml-parser` throws; wrap as `"input is not valid XML: <native message>"`.
- Empty `<root></root>` → JSON `{"root": ""}` (fast-xml-parser default).
- XML with namespaces (`<svg:rect ...>`) → namespace prefix preserved verbatim in JSON keys. We don't strip — round-trip honesty for downstream tools.
- XML declaration + DOCTYPE → ignored (standard fast-xml-parser behavior).
- Mixed content (`<p>hello <b>world</b>!</p>`) → falls into fast-xml-parser's default text-and-children handling. Tooltip notes "best-effort on mixed-content elements."
- CDATA → unwrapped to text.
- Attribute prefix collision (`""` mode + element has attribute `foo` and child element `foo`) → fast-xml-parser overwrites; we surface no warning. Tooltip notes: `` "prefix \"\" can collide on elements with both an attribute and a child of the same name; default \"@\" avoids this" ``.

**Engine descriptor:** `category: "data"`, `library: "fast-xml-parser"`, `license: "MIT"`. No `archiveSuffix`.

### 2.6 Sidebar — `DATA` group lands in Phase 25

Per the convention from Phases 19/20 (AUDIO), 21/22 (VIDEO), 23 (OCR), 24 (ARCHIVES): each phase ships its own group as it lands; Phase 26 closeout reorders to canonical order.

Current `GROUP_ORDER` (post-Phase 24): `HOME → IMAGES → PDFS → DOCS → AUDIO → VIDEO → OCR → ARCHIVES → ABOUT`.

After Phase 25: `HOME → IMAGES → PDFS → DOCS → AUDIO → VIDEO → OCR → ARCHIVES → DATA → ABOUT`. Phase 26 reorders to v2 spec §4.1 canonical: `... → AUDIO → VIDEO → ARCHIVES → DATA → OCR → ABOUT`.

### 2.7 Home grid — flat in Phase 25, sectioned in Phase 26

Three new engine cards added to the existing flat grid in `src/app/page.tsx`. Sectioning by category is Phase 26 closeout work.

Tool count in home page status bar (`src/app/page.test.tsx`) bumps 20 → 23.

## 3. UX commitments

- **Latency:** all three engines are fast (instant on typical inputs; potentially seconds on near-cap 50 MB text). Existing spinner suffices — no progress UI required.
- **Per-engine routes:** `src/app/tools/data-convert/page.tsx`, `json-format/page.tsx`, `xml-to-json/page.tsx`, standard `ToolFrame` pattern.
- **Error messages** are actionable verbatim per §2.3–§2.5 above.
- **`/about` engines table** auto-populates; each engine ships `library` and `license` fields.

## 4. Testing strategy

### 4.1 Co-located unit + integration tests (per project convention)

**`data-convert/`:**
- `index.test.ts`: descriptor fields, lenient validate (ext OR MIME), 50 MB cap rejection.
- `worker.test.ts`: real conversions across all 3 × 2 = 6 cross-format pairs (csv→json, csv→yaml, json→csv, json→yaml, yaml→csv, yaml→json) against committed fixtures; same-format rejection (csv→csv); tree→CSV shape rejections (3 cases: non-array, nested value, missing key); YAML SAFE_SCHEMA rejection; XML-input rejection.
- `options.test.ts`: shape unit tests.
- `options-panel.test.tsx`: render, format toggle.

**`json-format/`:**
- `index.test.ts`: descriptor + validate.
- `worker.test.ts`: pretty + minify + indent variants; BOM strip; empty file rejection; invalid-JSON rejection.
- `options.test.ts` + `options-panel.test.tsx`: mode + indent UI.

**`xml-to-json/`:**
- `index.test.ts`: descriptor + validate.
- `worker.test.ts`: happy-path round-trip; attribute prefix variants; namespace preservation; mixed-content; malformed XML rejection.
- `options.test.ts` + `options-panel.test.tsx`: attribute prefix UI.

### 4.2 E2E (`tests/e2e/`)

- `data-convert.spec.ts`: drag-drop sample.csv → JSON output downloads; sample.yaml → CSV output downloads; nested.json → tree-shape rejection error UI.
- `json-format.spec.ts`: drag-drop sample.json → pretty output; toggle minify; toggle indent.
- `xml-to-json.spec.ts`: drag-drop sample.xml → JSON output; toggle attribute prefix.
- `privacy-regression-data-convert.spec.ts`, `privacy-regression-json-format.spec.ts`, `privacy-regression-xml-to-json.spec.ts`: zero off-origin during real conversions.
- `tests/e2e/coop-coep.spec.ts`: extends `TOOL_ROUTES` with `/tools/data-convert`, `/tools/json-format`, `/tools/xml-to-json`.

### 4.3 Fixtures — `tests/fixtures/data/`

All hand-authored, all < 1 KB, all committed. No build script needed (vs. Phase 24's binary forging).

| Fixture | Contents |
|---|---|
| `sample.csv` | 3 columns × 4 rows + header (`id,name,score` style) |
| `sample.json` | corresponding tree (array of 4 flat objects) |
| `sample.yaml` | corresponding tree |
| `sample.xml` | nested element tree with attributes (5 elements deep) |
| `nested.json` | array containing an object with a nested object value (for tree → CSV rejection test) |
| `non-array.json` | top-level object — not array (for tree → CSV rejection test) |
| `missing-key.json` | array where row 3 is missing a key (for tree → CSV rejection test) |
| `unsafe.yaml` | uses `!!js/function` tag (for SAFE_SCHEMA rejection test) |
| `bom.json` | leading UTF-8 BOM + valid JSON (for json-format BOM-strip test) |
| `mixed.xml` | mixed content (text + elements) for xml-to-json edge-case smoke |
| `namespaced.xml` | element with namespace prefix for xml-to-json round-trip |

### 4.4 Bundle isolation

`scripts/check-bundle-isolation.mjs` already enumerates engines under `src/engines/` automatically; it picks up the three new engines. Phase 25 verifies that:
- `papaparse` is dynamically imported only from `data-convert/worker.ts`.
- `js-yaml` is dynamically imported only from `data-convert/worker.ts`.
- `fast-xml-parser` is dynamically imported only from `xml-to-json/worker.ts`.
- None of the three appear in the homepage chunk.

### 4.5 Verification gates (must be green before merge)

- `pnpm lint` `pnpm typecheck` `pnpm test` `pnpm test:e2e` all green.
- All 11 fixtures behave as documented.
- Privacy E2E: zero outbound network during all three engines' conversions.
- Bundle-isolation: papaparse + js-yaml + fast-xml-parser not in homepage chunk.

## 5. Risks

1. **`papaparse` and `js-yaml` are net-new third-party deps.** Both MIT, both popular and well-maintained (papaparse 13M weekly downloads on npm; js-yaml 90M). Low supply-chain risk, but each adds bundle weight even when lazy-loaded (~45 KB and ~40 KB minified). Mitigation: lazy-load discipline enforced by bundle-isolation script.
2. **CSV → tree heuristics on real-world inputs.** Files with stray header whitespace, mixed line endings, or quoted fields containing commas all need to round-trip cleanly via papaparse's defaults. Trust papaparse defaults; if a real-world file breaks, surface as a Phase 25.x patch rather than over-engineering pre-emptive heuristics.
3. **YAML SAFE_SCHEMA may reject real-world YAML.** Some YAML files use `!!timestamp` (which is in CORE_SCHEMA but not SAFE). If users hit this often post-merge, escalate to CORE_SCHEMA (no JS-typed constructors, just adds standard scalar tags). Documented in tooltip and in the YAML rejection error message.
4. **`fast-xml-parser` mixed-content handling is best-effort.** Documented in tooltip, not blocking. Mixed-content fidelity isn't a v2 quality goal.

## 6. Deviations from v2 spec §3.4

To be folded into the v2 spec amendment in Phase 26.

1. **Same-format rejection added to `data-convert`.** v2 spec is silent on the no-op case (csv→csv, json→json, yaml→yaml); Phase 25 chooses to reject with a friendly message pointing at `json-format` as the right tool for JSON-to-JSON normalization. Stricter than spec, no spec change needed but worth recording.
2. **YAML schema fixed to SAFE_SCHEMA.** v2 spec doesn't specify schema; Phase 25 hard-codes SAFE for security (blocks JS-typed constructors). Documented in user-facing tooltip and rejection error message.
3. **BOM stripping in `json-format`.** v2 spec doesn't mention BOM handling; Phase 25 strips leading UTF-8 BOM silently before parsing. Otherwise common editor outputs would fail JSON.parse.

## 7. Out of scope (deferred from Phase 25)

Beyond v2-wide deferrals in master spec §1.3:

- **JSON → XML reconstruction.** Lossy without a reconstruction strategy; deferred until that strategy is validated.
- **TOML support in `data-convert`.** Would add a 5th lib; v2 spec §1.3 already defers.
- **CSV delimiter override.** Comma only in v2; tab/semicolon variants are a v2.x candidate.
- **YAML flow-style output.** Block-style only.
- **JSONC / JSON5 input acceptance for `json-format`.** Strict JSON only; comments/trailing-commas would need a separate parser.
- **Multi-input data engines.** All three are single-input.
- **Schema validation.** No JSON Schema, no XML Schema / DTD validation.
- **Streaming for >50 MB inputs.** All three engines parse the full input in memory.

## 8. Plan structure preview

The Phase 25 plan (generated next via `superpowers:writing-plans`) will follow the per-task verify-pass/fail pattern from Phase 24 and is expected to look approximately:

1. **Task 0** — `EngineCategory: "data"` + `SIZE_LIMITS_MB.data` prep + tests; install `papaparse` + `js-yaml` deps.
2. **Task 1** — fixtures (11 hand-authored files committed under `tests/fixtures/data/`).
3. **Task 2** — `data-convert/` engine: descriptor, options, OptionsPanel, worker, tests.
4. **Task 3** — `data-convert/` route + sidebar/home/COOP wiring + E2E + privacy regression.
5. **Task 4** — `json-format/` engine: descriptor, options, OptionsPanel, worker, tests.
6. **Task 5** — `json-format/` route + wiring + E2E + privacy regression.
7. **Task 6** — `xml-to-json/` engine: descriptor, options, OptionsPanel, worker, tests.
8. **Task 7** — `xml-to-json/` route + wiring + E2E + privacy regression.
9. **Task 8** — final verification gate + branch push + PR.
