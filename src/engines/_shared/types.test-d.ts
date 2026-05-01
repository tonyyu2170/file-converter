import { describe, expectTypeOf, it } from "vitest";
import type {
  ConversionEngine,
  MultiInputEngine,
  OutputItem,
  SingleInputEngine,
  ValidationResult,
} from "./types";

describe("types", () => {
  it("ValidationResult discriminates on ok", () => {
    const v = {} as ValidationResult;
    if (v.ok) {
      expectTypeOf(v).toMatchTypeOf<{ ok: true }>();
    } else {
      expectTypeOf(v.reason).toBeString();
    }
  });

  it("SingleInputEngine takes one File and returns OutputItem(s)", () => {
    type E = SingleInputEngine<{ q: number }, OutputItem>;
    const e = {} as E;
    expectTypeOf(e.convert).parameter(0).toMatchTypeOf<File>();
    expectTypeOf(e.cardinality).toEqualTypeOf<"single">();
  });

  it("MultiInputEngine takes File[] and returns OutputItem(s)", () => {
    type E = MultiInputEngine<{ q: number }, OutputItem>;
    const e = {} as E;
    expectTypeOf(e.convert).parameter(0).toMatchTypeOf<File[]>();
    expectTypeOf(e.cardinality).toEqualTypeOf<"multi">();
  });

  it("ConversionEngine narrows by cardinality", () => {
    const e = {} as ConversionEngine;
    if (e.cardinality === "single") {
      expectTypeOf(e.convert).parameter(0).toMatchTypeOf<File>();
    }
  });
});
