/**
 * Syntax-highlighting helpers for the markdown-to-pdf renderer.
 *
 * Kept in its own module so the regex-driven HTML parser is
 * unit-testable without pulling in pdf-lib.
 *
 * highlight.js v11 emits HTML, not a token stream. We parse the HTML
 * with a tiny tag-walker rather than pulling in a DOM dep. The HTML is
 * well-formed (hljs's own output) so a regex-driven walker is safe here.
 */

import hljs from "highlight.js/lib/core";
import bashLang from "highlight.js/lib/languages/bash";
import jsLang from "highlight.js/lib/languages/javascript";
import jsonLang from "highlight.js/lib/languages/json";
import pythonLang from "highlight.js/lib/languages/python";
import tsLang from "highlight.js/lib/languages/typescript";

hljs.registerLanguage("javascript", jsLang);
hljs.registerLanguage("typescript", tsLang);
hljs.registerLanguage("python", pythonLang);
hljs.registerLanguage("bash", bashLang);
hljs.registerLanguage("json", jsonLang);

export type CodeToken = { text: string; color: [number, number, number] };

export const COLOR_KEYWORD: [number, number, number] = [0.0, 0.45, 0.7];
export const COLOR_STRING: [number, number, number] = [0.4, 0.4, 0.4];
export const COLOR_COMMENT: [number, number, number] = [0.55, 0.55, 0.55];
export const COLOR_DEFAULT: [number, number, number] = [0, 0, 0];

export function classToColor(cls: string): [number, number, number] {
  if (cls.startsWith("hljs-keyword")) return COLOR_KEYWORD;
  if (cls.startsWith("hljs-built_in") || cls.startsWith("hljs-type")) return COLOR_KEYWORD;
  if (cls.startsWith("hljs-string")) return COLOR_STRING;
  if (cls.startsWith("hljs-comment")) return COLOR_COMMENT;
  if (cls.startsWith("hljs-number")) return COLOR_KEYWORD;
  return COLOR_DEFAULT;
}

/**
 * Tokenise a code block via highlight.js and split into lines of
 * coloured tokens. Falls back to plain mono-coloured tokens when
 * the language is unknown or unregistered.
 */
export function highlightCodeBlock(text: string, language: string | null): CodeToken[][] {
  const useHljs = language && hljs.getLanguage(language);
  const html = useHljs
    ? hljs.highlight(text, { language: language as string }).value
    : escapeHtml(text);

  const flat = htmlToTokens(html);
  const lines: CodeToken[][] = [[]];
  for (const tok of flat) {
    const parts = tok.text.split("\n");
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part === undefined) continue;
      if (part.length > 0) {
        const lastLine = lines[lines.length - 1];
        if (lastLine) lastLine.push({ text: part, color: tok.color });
      }
      if (i < parts.length - 1) lines.push([]);
    }
  }
  return lines;
}

/**
 * Parse an hljs HTML fragment into flat CodeTokens.
 *
 * We use a character-level state machine rather than a non-greedy
 * regex so that nested `<span>` elements are handled correctly.
 * hljs v11 emits well-formed HTML (no attributes other than `class`,
 * no self-closing spans), so we only need to track:
 *   - `<span class="...">` open tags
 *   - `</span>` close tags
 *   - literal text runs between them
 *
 * The color stack applies the outermost-winning rule: if the inner
 * span emits COLOR_DEFAULT we inherit the outer span's color.
 */
export function htmlToTokens(
  html: string,
  outerColor: [number, number, number] = COLOR_DEFAULT,
): CodeToken[] {
  const tokens: CodeToken[] = [];
  let i = 0;

  while (i < html.length) {
    if (html[i] !== "<") {
      // Collect plain text until next tag.
      const start = i;
      while (i < html.length && html[i] !== "<") i++;
      const text = decodeHtml(html.slice(start, i));
      if (text) tokens.push({ text, color: outerColor });
      continue;
    }

    // We're at '<'. Determine which tag.
    if (html.startsWith("</span>", i)) {
      // Close tag — signal to caller by stopping.
      i += "</span>".length;
      break;
    }

    const spanOpenMatch = /^<span class="([^"]+)">/.exec(html.slice(i));
    if (spanOpenMatch) {
      const cls = spanOpenMatch[1] ?? "";
      const spanColor = classToColor(cls);
      i += spanOpenMatch[0].length;
      // Recursively parse the inner content, advancing i past the </span>.
      const innerStart = i;
      const inner = htmlToTokens(html.slice(i), spanColor);
      // Advance i by the number of characters consumed inside the
      // recursive call. We recompute by re-scanning for </span> depth.
      // Simpler: track via a sentinel — pass a wrapper that records pos.
      // Instead, we'll compute consumed by scanning forward.
      i += computeConsumed(html, innerStart);
      for (const t of inner) {
        // Inherit outer color only when inner is default.
        const color =
          t.color[0] === COLOR_DEFAULT[0] &&
          t.color[1] === COLOR_DEFAULT[1] &&
          t.color[2] === COLOR_DEFAULT[2]
            ? outerColor
            : t.color;
        tokens.push({ text: t.text, color });
      }
    } else {
      // Unknown tag — skip to '>'.
      while (i < html.length && html[i] !== ">") i++;
      if (i < html.length) i++;
    }
  }

  return tokens;
}

/**
 * Given the full html string and a start position that points to the
 * first character inside a span's content, return the number of
 * characters consumed including the closing `</span>`.
 *
 * Tracks nesting depth to handle nested spans correctly.
 */
function computeConsumed(html: string, start: number): number {
  let depth = 1;
  let i = start;
  while (i < html.length && depth > 0) {
    if (html.startsWith("</span>", i)) {
      depth--;
      i += "</span>".length;
    } else if (/<span\b/.test(html.slice(i, i + 6))) {
      // Another opening span.
      const m = /^<span\b[^>]*>/.exec(html.slice(i));
      depth++;
      i += m ? m[0].length : 1;
    } else {
      i++;
    }
  }
  return i - start;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function decodeHtml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
