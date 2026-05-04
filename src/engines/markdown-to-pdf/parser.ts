import MarkdownIt from "markdown-it";
import type { Block, Run, RunStyle } from "./blocks";

const md = new MarkdownIt({ html: false, breaks: false, linkify: true });

// Derive the Token type from the parse return type to avoid
// deep import issues with the @types/markdown-it package.
type Token = ReturnType<typeof md.parse>[number];

/**
 * Convert a markdown string to a flat list of layout blocks.
 *
 * Inline formatting (bold, italic, code, link) is collapsed into per-run
 * style flags within paragraph/heading/blockquote/list-item blocks.
 * Code blocks and HRs are top-level blocks. Images become placeholder
 * blocks (the renderer prints "[image: <alt>]"); embedding actual images
 * is deferred (would require fetching external URLs, breaking the
 * privacy guarantee).
 */
export function parseMarkdown(input: string): Block[] {
  const tokens = md.parse(input, {});
  const blocks: Block[] = [];

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (!token) {
      i++;
      continue;
    }

    switch (token.type) {
      case "heading_open": {
        const level = Number.parseInt(token.tag.slice(1), 10) as 1 | 2 | 3 | 4 | 5 | 6;
        const inline = tokens[i + 1];
        const runs = inline?.children ? inlineToRuns(inline.children) : [];
        blocks.push({ type: "heading", level, runs });
        i += 3; // heading_open, inline, heading_close
        break;
      }
      case "paragraph_open": {
        const inline = tokens[i + 1];
        const runs = inline?.children ? inlineToRuns(inline.children) : [];
        // Detect single-image paragraph: convert to image placeholder.
        if (inline?.children?.length === 1 && inline.children[0]?.type === "image") {
          const alt = inline.children[0].content ?? "";
          blocks.push({ type: "image", alt });
        } else {
          blocks.push({ type: "paragraph", runs });
        }
        i += 3;
        break;
      }
      case "bullet_list_open":
      case "ordered_list_open": {
        // Walk until matching close.
        const closeType =
          token.type === "bullet_list_open" ? "bullet_list_close" : "ordered_list_close";
        i++;
        while (i < tokens.length && tokens[i]?.type !== closeType) {
          const t = tokens[i];
          if (t?.type === "list_item_open") {
            // list_item_open, paragraph_open, inline, paragraph_close,
            // list_item_close
            const inline = tokens[i + 2];
            const runs = inline?.children ? inlineToRuns(inline.children) : [];
            blocks.push({ type: "list-item", depth: 0, runs });
            // Skip to list_item_close.
            while (i < tokens.length && tokens[i]?.type !== "list_item_close") i++;
            i++; // past list_item_close
          } else {
            i++;
          }
        }
        i++; // past list close
        break;
      }
      case "fence":
      case "code_block": {
        const language = token.info?.trim() || null;
        blocks.push({ type: "code-block", language, text: token.content });
        i++;
        break;
      }
      case "hr": {
        blocks.push({ type: "hr" });
        i++;
        break;
      }
      case "blockquote_open": {
        // blockquote_open, paragraph_open, inline, paragraph_close,
        // blockquote_close
        const inline = tokens[i + 2];
        const runs = inline?.children ? inlineToRuns(inline.children) : [];
        blocks.push({ type: "blockquote", runs });
        // Skip to blockquote_close.
        while (i < tokens.length && tokens[i]?.type !== "blockquote_close") i++;
        i++;
        break;
      }
      default:
        i++;
        break;
    }
  }

  return blocks;
}

function buildStyle(bold: boolean, italic: boolean, code: boolean, link: string | null): RunStyle {
  const s: RunStyle = {};
  if (bold) s.bold = true;
  if (italic) s.italic = true;
  if (code) s.code = true;
  if (link !== null) s.link = { href: link };
  return s;
}

function inlineToRuns(children: Token[]): Run[] {
  const runs: Run[] = [];
  let bold = false;
  let italic = false;
  let link: string | null = null;

  for (const child of children) {
    switch (child.type) {
      case "strong_open":
        bold = true;
        break;
      case "strong_close":
        bold = false;
        break;
      case "em_open":
        italic = true;
        break;
      case "em_close":
        italic = false;
        break;
      case "code_inline":
        runs.push({
          text: child.content,
          style: buildStyle(bold, italic, true, link),
        });
        break;
      case "link_open": {
        const href = child.attrs?.find((a: [string, string]) => a[0] === "href")?.[1] ?? "";
        link = href;
        break;
      }
      case "link_close":
        link = null;
        break;
      case "text":
        if (child.content) {
          runs.push({
            text: child.content,
            style: buildStyle(bold, italic, false, link),
          });
        }
        break;
      case "softbreak":
      case "hardbreak":
        runs.push({ text: " ", style: buildStyle(bold, italic, false, link) });
        break;
      // Skip image inside inline (handled at paragraph level).
      case "image":
        break;
      default:
        break;
    }
  }

  return runs;
}
