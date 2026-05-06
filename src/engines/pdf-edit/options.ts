export type PdfEditPage = {
  id: string;
  sourceIndex: number;
  rotation: 0 | 90 | 180 | 270;
};

export type PdfEditOptions = {
  pages: PdfEditPage[];
  totalSourcePages: number;
};

export const defaultPdfEditOptions: PdfEditOptions = {
  pages: [],
  totalSourcePages: 0,
};

function genId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Vitest jsdom may not expose crypto.randomUUID on older Node; deterministic enough fallback.
  return `pe-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

const ROTATIONS = [0, 90, 180, 270] as const;
type Rotation = (typeof ROTATIONS)[number];

function nextRotation(current: Rotation, addDegrees: 90 | 180 | 270 = 90): Rotation {
  return ((current + addDegrees) % 360) as Rotation;
}

export function seedFromPageCount(n: number): PdfEditOptions {
  const pages: PdfEditPage[] = [];
  for (let i = 0; i < n; i++) {
    pages.push({ id: genId(), sourceIndex: i, rotation: 0 });
  }
  return { pages, totalSourcePages: n };
}

export function rotatePage(opts: PdfEditOptions, id: string): PdfEditOptions {
  const idx = opts.pages.findIndex((p) => p.id === id);
  if (idx === -1) return opts;
  const target = opts.pages[idx]!;
  const nextPages = opts.pages.slice();
  nextPages[idx] = { ...target, rotation: nextRotation(target.rotation) };
  return { ...opts, pages: nextPages };
}

export function applyRotateAll(opts: PdfEditOptions): PdfEditOptions {
  const nextPages = opts.pages.map((p) => ({ ...p, rotation: nextRotation(p.rotation) }));
  return { ...opts, pages: nextPages };
}

export function deletePage(opts: PdfEditOptions, id: string): PdfEditOptions {
  const idx = opts.pages.findIndex((p) => p.id === id);
  if (idx === -1) return opts;
  const nextPages = opts.pages.slice();
  nextPages.splice(idx, 1);
  return { ...opts, pages: nextPages };
}

export function movePage(opts: PdfEditOptions, from: number, to: number): PdfEditOptions {
  if (from < 0 || from >= opts.pages.length) return opts;
  if (to < 0 || to >= opts.pages.length) return opts;
  if (from === to) return opts;
  const nextPages = opts.pages.slice();
  const [moved] = nextPages.splice(from, 1);
  if (moved) nextPages.splice(to, 0, moved);
  return { ...opts, pages: nextPages };
}
