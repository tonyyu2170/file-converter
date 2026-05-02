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

export function parseRange(input: string, pageCount: number): RangeParseResult {
  const trimmed = input.trim();
  if (trimmed === "") {
    const all: number[] = [];
    for (let i = 0; i < pageCount; i++) all.push(i);
    return { ok: true, indices: all };
  }

  // Detect leading/trailing comma errors before splitting
  if (trimmed.startsWith(",")) return { ok: false, reason: "leading comma" };
  if (trimmed.endsWith(",")) return { ok: false, reason: "trailing comma" };

  const tokens = trimmed.split(",");
  const indices: number[] = [];
  for (const token of tokens) {
    const result = parseToken(token, pageCount);
    if (!result.ok) return result;
    indices.push(...result.indices);
  }
  return { ok: true, indices };
}
