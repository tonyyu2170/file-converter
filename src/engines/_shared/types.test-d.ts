import { describe, expectTypeOf, it } from "vitest";
import type {
  ConversionEngine,
  EngineLicense,
  EngineMeta,
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

  it("OptionsPanelProps shape is value + onChange + optional file", () => {
    type OptsType = { foo: string };
    expectTypeOf<OptionsPanelProps<OptsType>>().toEqualTypeOf<{
      value: OptsType;
      onChange: (next: OptsType) => void;
      file?: File | undefined;
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

  it("EngineLicense accepts each known SPDX value and rejects others", () => {
    // Accepted values — each must be assignable to EngineLicense.
    expectTypeOf<"MIT">().toMatchTypeOf<EngineLicense>();
    expectTypeOf<"Apache-2.0">().toMatchTypeOf<EngineLicense>();
    expectTypeOf<"BSD-3-Clause">().toMatchTypeOf<EngineLicense>();
    expectTypeOf<"ISC">().toMatchTypeOf<EngineLicense>();
    expectTypeOf<"GPL-2.0-or-later">().toMatchTypeOf<EngineLicense>();
    expectTypeOf<"mixed">().toMatchTypeOf<EngineLicense>();

    // The union contains exactly these six literals — no more, no less.
    expectTypeOf<EngineLicense>().toEqualTypeOf<
      "MIT" | "Apache-2.0" | "BSD-3-Clause" | "ISC" | "GPL-2.0-or-later" | "mixed"
    >();

    // Rejected value — arbitrary string must NOT extend EngineLicense.
    // @ts-expect-error "GPL-3.0" is not a valid EngineLicense
    const _bad: EngineLicense = "GPL-3.0";
    void _bad;
  });

  it("library and license are optional on EngineMeta", () => {
    // A value without library/license must still be assignable to EngineMeta.
    type Opts = { q: number };
    const withoutOptionals = {
      id: "test",
      inputAccept: [".png"],
      inputMime: ["image/png"],
      outputMime: "image/png",
      defaultOptions: { q: 1 },
      category: "image" as const,
    } satisfies EngineMeta<Opts>;
    expectTypeOf(withoutOptionals).toMatchTypeOf<EngineMeta<Opts>>();

    // Optional fields are typed correctly when present.
    expectTypeOf<EngineMeta<Opts>["library"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<EngineMeta<Opts>["license"]>().toEqualTypeOf<EngineLicense | undefined>();
  });
});
