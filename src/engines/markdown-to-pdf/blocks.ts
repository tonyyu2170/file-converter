export type RunStyle = {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  link?: { href: string };
};

export type Run = {
  text: string;
  style: RunStyle;
};

export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; runs: Run[] }
  | { type: "paragraph"; runs: Run[] }
  | { type: "list-item"; depth: number; runs: Run[] }
  | { type: "code-block"; language: string | null; text: string }
  | { type: "blockquote"; runs: Run[] }
  | { type: "hr" }
  | { type: "image"; alt: string };
