/**
 * Module-internal helper: a no-op page shim used by measure-only passes
 * (table cell measurement in `tables.ts`, multi-column natural-fill
 * measurement in `multi-column.ts`).
 *
 * Layout primitives draw eagerly — the only way to measure a block's
 * natural height is to actually invoke `layoutBlock` on it. The discard
 * page absorbs every draw vocabulary call (`drawText` / `drawLine` /
 * `drawRectangle` / `drawImage`) and the pdf-lib annotation API surface
 * (`doc.context.obj`, `doc.context.register`, `node.addAnnot`) so that
 * the measure pass produces no real PDF content and registers no
 * duplicate annotations.
 *
 * Known limitation: list paragraphs measured against a discard page will
 * still bump their counter twice (once in measure, once in draw) because
 * the counter lives on `LayoutDeps.listState`, not on the page. Callers
 * that care about counter purity must pass a scratch `LayoutDeps` to the
 * measure pass (`multi-column.ts` does this for Pass 1; `tables.ts`'s
 * cell measurement does not, since none of v1's fixtures place a list
 * inside a table cell).
 */

import type { ColumnContext } from "./types";

export function makeDiscardPage(): ColumnContext["page"] {
  const noopContext = {
    obj<T>(literal: T): T {
      return literal;
    },
    register<T>(_obj: T): { __discard: true } {
      return { __discard: true };
    },
  };
  const shim = {
    drawText() {},
    drawLine() {},
    drawRectangle() {},
    drawImage() {},
    getSize() {
      return { width: 612, height: 792 };
    },
    doc: { context: noopContext },
    node: { addAnnot(_ref: unknown) {} },
  };
  return shim as unknown as ColumnContext["page"];
}
