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
 * `LayoutDeps.listState` lives outside the page, so a measure pass that
 * advances list counters would leak into the subsequent draw pass. Both
 * `multi-column.ts:passOneNaturalHeight` (whole scratch deps) and
 * `tables.ts:measureCellContent` (just `listState`, via
 * `cloneListState`) build scratch deps so counters stay pure.
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
