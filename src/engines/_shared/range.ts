export type RangeParseResult = { ok: true; indices: number[] } | { ok: false; reason: string };

const POSITIVE_INT = /^[1-9][0-9]*$/;
const ALL_ZEROS = /^0+$/;

function parseToken(token: string, pageCount: number): RangeParseResult {
  const trimmed = token.trim();
  if (trimmed === "") return { ok: false, reason: "empty token" };
  if (trimmed === "-") return { ok: false, reason: "bare dash is not a range" };

  // Open-ended forms: "N-" or "-M"
  if (trimmed.endsWith("-")) {
    const head = trimmed.slice(0, -1).trim();
    if (!POSITIVE_INT.test(head)) {
      return ALL_ZEROS.test(head)
        ? { ok: false, reason: "page numbers must be 1 or greater" }
        : { ok: false, reason: `can't parse '${trimmed}'` };
    }
    const n = Number.parseInt(head, 10);
    if (n > pageCount) return { ok: false, reason: `page ${n} exceeds ${pageCount}` };
    const indices: number[] = [];
    for (let i = n - 1; i < pageCount; i++) indices.push(i);
    return { ok: true, indices };
  }
  if (trimmed.startsWith("-")) {
    const tail = trimmed.slice(1).trim();
    if (!POSITIVE_INT.test(tail)) {
      return ALL_ZEROS.test(tail)
        ? { ok: false, reason: "page numbers must be 1 or greater" }
        : { ok: false, reason: `can't parse '${trimmed}'` };
    }
    const m = Number.parseInt(tail, 10);
    if (m > pageCount) return { ok: false, reason: `page ${m} exceeds ${pageCount}` };
    const indices: number[] = [];
    for (let i = 0; i < m; i++) indices.push(i);
    return { ok: true, indices };
  }

  // Closed range: "N-M"
  if (trimmed.includes("-")) {
    const parts = trimmed.split("-");
    if (parts.length !== 2) return { ok: false, reason: `can't parse '${trimmed}'` };
    const [headRaw, tailRaw] = parts;
    const head = (headRaw ?? "").trim();
    const tail = (tailRaw ?? "").trim();
    if (ALL_ZEROS.test(head) || ALL_ZEROS.test(tail)) {
      return { ok: false, reason: "page numbers must be 1 or greater" };
    }
    if (!POSITIVE_INT.test(head) || !POSITIVE_INT.test(tail)) {
      return { ok: false, reason: `can't parse '${trimmed}'` };
    }
    const n = Number.parseInt(head, 10);
    const m = Number.parseInt(tail, 10);
    if (n > m) return { ok: false, reason: `${trimmed} is reversed (start > end)` };
    if (n > pageCount || m > pageCount) {
      return { ok: false, reason: `page ${Math.max(n, m)} exceeds ${pageCount}` };
    }
    const indices: number[] = [];
    for (let i = n - 1; i < m; i++) indices.push(i);
    return { ok: true, indices };
  }

  // Single page: "N"
  if (ALL_ZEROS.test(trimmed)) {
    return { ok: false, reason: "page numbers must be 1 or greater" };
  }
  if (!POSITIVE_INT.test(trimmed)) {
    return { ok: false, reason: `can't parse '${trimmed}'` };
  }
  const n = Number.parseInt(trimmed, 10);
  if (n > pageCount) return { ok: false, reason: `page ${n} exceeds ${pageCount}` };
  return { ok: true, indices: [n - 1] };
}

export type RangeTokensResult =
  | { ok: true; tokens: Array<{ original: string; indices: number[] }> }
  | { ok: false; reason: string };

export function parseRangeTokens(input: string, pageCount: number): RangeTokensResult {
  const trimmed = input.trim();
  if (trimmed === "") return { ok: true, tokens: [] };

  // Detect leading/trailing comma errors before splitting (matches parseRange).
  if (trimmed.startsWith(",")) return { ok: false, reason: "leading comma" };
  if (trimmed.endsWith(",")) return { ok: false, reason: "trailing comma" };

  const rawTokens = trimmed.split(",");
  const tokens: Array<{ original: string; indices: number[] }> = [];
  for (const raw of rawTokens) {
    const trimmedRaw = raw.trim();
    const result = parseToken(trimmedRaw, pageCount);
    if (!result.ok) return result;
    tokens.push({ original: trimmedRaw, indices: result.indices });
  }
  return { ok: true, tokens };
}

export function parseRange(input: string, pageCount: number): RangeParseResult {
  // Asymmetry with parseRangeTokens on empty input is intentional:
  // parseRange's legacy pdf-merge contract treats empty as "all pages",
  // while parseRangeTokens treats empty as "no tokens" (the engine's
  // isReadyToConvert is the gate for empty in pdf-split).
  if (input.trim() === "") {
    const all: number[] = [];
    for (let i = 0; i < pageCount; i++) all.push(i);
    return { ok: true, indices: all };
  }
  const result = parseRangeTokens(input, pageCount);
  if (!result.ok) return result;
  const indices: number[] = [];
  for (const t of result.tokens) indices.push(...t.indices);
  return { ok: true, indices };
}
