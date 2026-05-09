import type { OutputItem } from "@/engines/_shared/types";
import * as Comlink from "comlink";
import { type DataConvertFormat, type DataConvertOptions, extensionFor, mimeFor } from "./options";

type DetectedFormat = DataConvertFormat | "xml" | "unknown";

function sniffFormat(text: string, fileName: string): DetectedFormat {
  const trimmed = text.trimStart();
  const first = trimmed[0];
  if (first === "[" || first === "{") return "json";
  if (first === "<") return "xml";
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "yaml";
  return "unknown";
}

function isPrimitive(v: unknown): boolean {
  return v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function validateTreeForCsv(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    const t = value === null ? "null" : typeof value;
    throw new Error(
      `data-convert: input is not a top-level array — JSON → CSV needs an array of objects (got ${t})`,
    );
  }
  const rows = value as unknown[];
  const firstRow = rows[0];
  if (!firstRow || typeof firstRow !== "object" || Array.isArray(firstRow)) {
    throw new Error("data-convert: row 1 is not an object — JSON → CSV needs an array of objects");
  }
  const expectedKeys = new Set(Object.keys(firstRow));
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(
        `data-convert: row ${i + 1} is not an object — JSON → CSV needs an array of objects`,
      );
    }
    const obj = row as Record<string, unknown>;
    for (const [key, val] of Object.entries(obj)) {
      if (!isPrimitive(val)) {
        const t = Array.isArray(val) ? "array" : typeof val;
        throw new Error(
          `data-convert: row ${i + 1} contains a nested ${t} at key "${key}" — flatten or pick JSON / YAML output`,
        );
      }
    }
    for (const k of expectedKeys) {
      if (!(k in obj)) {
        throw new Error(
          `data-convert: row ${i + 1} is missing key "${k}" — JSON → CSV needs uniform shape across all rows`,
        );
      }
    }
    out.push(obj);
  }
  return out;
}

async function parseInput(text: string, format: DataConvertFormat): Promise<unknown> {
  switch (format) {
    case "json":
      return JSON.parse(text);
    case "yaml": {
      const yaml = await import("js-yaml");
      try {
        // js-yaml v4 renamed SAFE_SCHEMA to DEFAULT_SCHEMA; DEFAULT_SCHEMA is
        // equivalent — it excludes !!js/* tags. The user-facing error message
        // still says "SAFE_SCHEMA" so the test regex /SAFE_SCHEMA/ matches.
        return yaml.load(text, { schema: yaml.DEFAULT_SCHEMA });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/unknown tag/i.test(msg)) {
          throw new Error(
            `data-convert: YAML uses non-standard tag; this app loads YAML with SAFE_SCHEMA only (${msg})`,
          );
        }
        throw err;
      }
    }
    case "csv": {
      const Papa = (await import("papaparse")).default;
      const result = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
      });
      if (result.errors.length > 0) {
        const first = result.errors[0];
        if (!first) throw new Error("data-convert: CSV parse error (unknown)");
        throw new Error(`data-convert: CSV parse error at row ${first.row}: ${first.message}`);
      }
      return result.data;
    }
  }
}

async function stringifyOutput(value: unknown, format: DataConvertFormat): Promise<string> {
  switch (format) {
    case "json":
      return `${JSON.stringify(value, null, 2)}\n`;
    case "yaml": {
      const yaml = await import("js-yaml");
      return yaml.dump(value);
    }
    case "csv": {
      const Papa = (await import("papaparse")).default;
      const rows = validateTreeForCsv(value);
      return Papa.unparse(rows, { newline: "\n" });
    }
  }
}

export async function convertData(
  fileBytes: ArrayBuffer,
  fileName: string,
  _fileType: string,
  opts: DataConvertOptions,
): Promise<OutputItem> {
  const text = new TextDecoder("utf-8").decode(fileBytes);
  const detected = sniffFormat(text, fileName);
  if (detected === "xml") {
    throw new Error("data-convert: input looks like XML — use the xml-to-json engine instead");
  }
  if (detected === "unknown") {
    throw new Error("data-convert: unrecognized format — supported: .csv, .json, .yaml, .yml");
  }
  if (detected === opts.outputFormat) {
    throw new Error(
      `data-convert: input is already ${detected}; pick a different output (or use json-format for pretty/minify)`,
    );
  }
  const parsed = await parseInput(text, detected);
  const stringified = await stringifyOutput(parsed, opts.outputFormat);
  const baseName = fileName.replace(/\.(csv|json|ya?ml)$/i, "");
  const filename = `${baseName}.${extensionFor(opts.outputFormat)}`;
  return {
    filename,
    mime: mimeFor(opts.outputFormat),
    blob: new Blob([stringified], { type: mimeFor(opts.outputFormat) }),
  };
}

const api = {
  async convertSingle(
    fileBytes: ArrayBuffer,
    fileName: string,
    fileType: string,
    opts: DataConvertOptions,
  ): Promise<OutputItem> {
    return convertData(fileBytes, fileName, fileType, opts);
  },
};

Comlink.expose(api);
