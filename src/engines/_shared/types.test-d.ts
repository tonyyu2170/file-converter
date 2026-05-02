import { describe, expectTypeOf, it } from "vitest";
import type {
  ConversionEngine,
  MultiInputEngine,
  OptionsPanelProps,
  OutputItem,
  SingleInputEngine,
  StagingAreaProps,
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

  it("isReadyToConvert is optional on SingleInputEngine", () => {
    type OptsType = { foo: string };
    type SE = SingleInputEngine<OptsType, OutputItem>;
    expectTypeOf<SE["isReadyToConvert"]>().toEqualTypeOf<
      ((opts: OptsType) => boolean) | undefined
    >();
  });

  it("OptionsPanelProps shape is value + onChange", () => {
    type OptsType = { foo: string };
    expectTypeOf<OptionsPanelProps<OptsType>>().toEqualTypeOf<{
      value: OptsType;
      onChange: (next: OptsType) => void;
    }>();
  });

  it("StagingArea is optional on MultiInputEngine and absent on SingleInputEngine", () => {
    type MOpts = { paper: "letter" | "a4" };
    type ME = MultiInputEngine<MOpts, { filename: string; mime: string; blob: Blob }>;
    expectTypeOf<ME["StagingArea"]>().toEqualTypeOf<
      import("react").ComponentType<StagingAreaProps<MOpts>> | undefined
    >();
  });

  it("StagingAreaProps shape is correctly parameterized", () => {
    type Opts = { foo: string };
    expectTypeOf<StagingAreaProps<Opts>>().toEqualTypeOf<{
      files: File[];
      onChange: (next: File[]) => void;
      options: Opts;
      setOptions: (next: Opts) => void;
    }>();
  });
});
