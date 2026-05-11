import { describe, expect, it } from "vitest";

import type { Lockfile, NamedFunction, ProjectMetadata } from "../src/adapter.js";
import type { FunctionOrigin } from "../src/reconciler/index.js";
import {
  normalizeFunction,
  normalizeLockfile,
  normalizeProjectMetadata,
} from "../src/reconciler/index.js";

describe("reconciler normalization helpers", () => {
  it("normalizes spreadsheet named functions into workbook functions", () => {
    const fn: NamedFunction = {
      name: "ADD_TAX",
      definition: "=price * (1 + rate)",
      description: "Applies tax to a price.",
      parameters: [
        { name: "price", description: "Base price.", examples: ["100"] },
        { name: "rate", description: "Tax rate.", examples: ["0.0825"] },
      ],
    };

    const normalized = normalizeFunction(fn);

    expect(normalized).toEqual({
      name: "ADD_TAX",
      definition: "=price * (1 + rate)",
      description: "Applies tax to a price.",
      parameters: [
        {
          name: "price",
          description: "Base price.",
          examples: ["100"],
        },
        {
          name: "rate",
          description: "Tax rate.",
          examples: ["0.0825"],
        },
      ],
      examples: [],
      origin: { kind: "unknown" },
      hash: expect.stringMatching(/^sha256:/),
    });
  });

  it("hashes equivalent argument metadata consistently regardless of insertion order", () => {
    const first: NamedFunction = {
      name: "ADD_TAX",
      definition: "=price * (1 + rate)",
      parameters: [
        { name: "price", description: "Base price.", examples: ["100"] },
        { name: "rate", description: "Tax rate.", examples: ["0.0825"] },
      ],
    };
    const second: NamedFunction = {
      name: "ADD_TAX",
      definition: "=price * (1 + rate)",
      parameters: [
        { name: "price", description: "Base price.", examples: ["100"] },
        { name: "rate", description: "Tax rate.", examples: ["0.0825"] },
      ],
    };

    expect(normalizeFunction(second).hash).toBe(normalizeFunction(first).hash);
  });

  it("clones caller-provided function origins", () => {
    const fn: NamedFunction = {
      name: "ADD_TAX",
      definition: "=price * (1 + rate)",
      parameters: [],
    };
    const origin: FunctionOrigin = {
      kind: "package",
      packageName: "charter",
      version: "1.0.0",
      integrity: "sha256:original",
    };

    const normalized = normalizeFunction(fn, origin);
    origin.packageName = "mutated";
    origin.version = "2.0.0";
    origin.integrity = "sha256:mutated";

    expect(normalized.origin).toEqual({
      kind: "package",
      packageName: "charter",
      version: "1.0.0",
      integrity: "sha256:original",
    });
  });

  it("clones caller-provided function parameters", () => {
    const fn: NamedFunction = {
      name: "ADD_TAX",
      definition: "=price * (1 + rate)",
      parameters: [
        { name: "price", description: "Base price.", examples: ["100"] },
      ],
    };

    const normalized = normalizeFunction(fn);
    fn.parameters[0].description = "mutated";
    fn.parameters[0].examples.push("200");

    expect(normalized.parameters).toEqual([
      { name: "price", description: "Base price.", examples: ["100"] },
    ]);
  });

  it("normalizes project metadata into project state", () => {
    const meta: ProjectMetadata = {
      dependencies: {
        charter: "^1.0.0",
      },
    };

    expect(normalizeProjectMetadata(meta, ["excel:file:test"])).toEqual({
      schemaVersion: 1,
      initialized: true,
      name: undefined,
      version: undefined,
      description: undefined,
      license: undefined,
      owners: [],
      directDependencies: {
        charter: "^1.0.0",
      },
      exports: [],
      targetIds: ["excel:file:test"],
    });
  });

  it("splits and trims project owner and export lists", () => {
    const meta: ProjectMetadata = {
      owners: " Alice ,Bob,,  Carol  ",
      exports: "ADD_TAX, , TOTAL_TAX ",
      dependencies: {},
    };

    const normalized = normalizeProjectMetadata(meta, ["excel:file:test"]);

    expect(normalized.owners).toEqual(["Alice", "Bob", "Carol"]);
    expect(normalized.exports).toEqual(["ADD_TAX", "TOTAL_TAX"]);
  });

  it("normalizes missing project metadata into uninitialized project state", () => {
    expect(normalizeProjectMetadata(null, ["excel:file:test"])).toEqual({
      schemaVersion: 1,
      initialized: false,
      name: undefined,
      version: undefined,
      description: undefined,
      license: undefined,
      owners: [],
      directDependencies: {},
      exports: [],
      targetIds: ["excel:file:test"],
    });
  });

  it("normalizes lockfiles and marks direct dependencies", () => {
    const lockfile: Lockfile = {
      packages: {
        charter: {
          version: "1.0.3",
          dependencies: ["utils"],
          functions: ["CHARTER_TOTAL"],
        },
        utils: {
          version: "2.1.0",
          dependencies: [],
          functions: ["UTIL_ROUND"],
        },
      },
    };

    expect(normalizeLockfile(lockfile, { charter: "^1.0.0" })).toEqual({
      schemaVersion: 1,
      packages: {
        charter: {
          name: "charter",
          version: "1.0.3",
          resolved: undefined,
          integrity: undefined,
          dependencies: ["utils"],
          functions: ["CHARTER_TOTAL"],
          direct: true,
        },
        utils: {
          name: "utils",
          version: "2.1.0",
          resolved: undefined,
          integrity: undefined,
          dependencies: [],
          functions: ["UTIL_ROUND"],
          direct: false,
        },
      },
    });
  });

  it("normalizes missing lockfiles into empty lockfile state", () => {
    expect(normalizeLockfile(null, {})).toEqual({
      schemaVersion: 1,
      packages: {},
    });
  });
});
