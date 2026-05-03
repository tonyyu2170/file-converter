# subset-fonts.mjs

Reproducible subsetter for the bundled OSS fonts used by the
`docx-to-pdf` engine. Outputs ~775 KB of TTFs to `public/fonts/`.

## Usage

```bash
node tools/subset-fonts.mjs
```

Source fonts are fetched on first run from the canonical [`google/fonts`](https://github.com/google/fonts)
repository and cached under `$TMPDIR/docx-to-pdf-font-sources/`. Subsequent runs are offline.

## What it produces

Ten static TTFs, each pinned from a variable-axis source TTF:

| Output | Source | Axes |
|---|---|---|
| `inter-regular.ttf`        | `ofl/inter/Inter[opsz,wght].ttf`        | wght=400, opsz=14 |
| `inter-bold.ttf`           | `ofl/inter/Inter[opsz,wght].ttf`        | wght=700, opsz=14 |
| `inter-italic.ttf`         | `ofl/inter/Inter-Italic[opsz,wght].ttf` | wght=400, opsz=14 |
| `inter-bold-italic.ttf`    | `ofl/inter/Inter-Italic[opsz,wght].ttf` | wght=700, opsz=14 |
| `lora-regular.ttf`         | `ofl/lora/Lora[wght].ttf`               | wght=400 |
| `lora-bold.ttf`            | `ofl/lora/Lora[wght].ttf`               | wght=700 |
| `lora-italic.ttf`          | `ofl/lora/Lora-Italic[wght].ttf`        | wght=400 |
| `lora-bold-italic.ttf`     | `ofl/lora/Lora-Italic[wght].ttf`        | wght=700 |
| `jetbrains-mono-regular.ttf` | `ofl/jetbrainsmono/JetBrainsMono[wght].ttf` | wght=400 |
| `jetbrains-mono-bold.ttf`  | `ofl/jetbrainsmono/JetBrainsMono[wght].ttf` | wght=700 |

Each is subset to a glyph range covering Basic Latin (ASCII), Latin-1 Supplement, Latin Extended-A, common General Punctuation, currency symbols, plus a handful of typographic glyphs commonly found in Word documents. Full range list is in the script's `buildSubsetGlyphString()`.

## Licenses

All three families are SIL Open Font License 1.1:

- **Inter** — Copyright (c) 2016–present The Inter Project Authors. <https://github.com/rsms/inter>
- **Lora** — Copyright (c) 2011–present The Lora Project Authors. <https://github.com/cyrealtype/Lora-Cyrillic>
- **JetBrains Mono** — Copyright (c) 2020 The JetBrains Mono Project Authors. <https://github.com/JetBrains/JetBrainsMono>

The OFL permits embedding these subsets in PDF outputs without attribution.

## When to re-run

Re-run only when:
- Upstream releases a new version with glyph fixes that affect the supported subset.
- We expand the supported glyph range (e.g., adding Cyrillic or Greek).

The committed outputs are deterministic given a fixed source version, but the source repository is unpinned (we always fetch `main`). If reproducibility matters, pin the fetch commit in the script.
