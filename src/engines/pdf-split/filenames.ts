type Token = { original: string; indices: number[] };

function baseName(token: Token): string {
  if (token.indices.length === 0) return "page-empty.pdf";
  if (token.indices.length === 1) {
    const page = (token.indices[0] ?? 0) + 1;
    return `page-${page}.pdf`;
  }
  const start = (token.indices[0] ?? 0) + 1;
  const end = (token.indices[token.indices.length - 1] ?? 0) + 1;
  return `pages-${start}-${end}.pdf`;
}

export function planSplitFilenames(tokens: ReadonlyArray<Token>): string[] {
  const seen = new Map<string, number>();
  const out: string[] = [];
  for (const token of tokens) {
    const base = baseName(token);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    if (count === 0) {
      out.push(base);
    } else {
      const ext = base.endsWith(".pdf") ? ".pdf" : "";
      const stem = base.slice(0, base.length - ext.length);
      out.push(`${stem}-${count + 1}${ext}`);
    }
  }
  return out;
}
