import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parseBundle } from "../src/bundle.js";

function makeZip(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content);
  }
  return zip.generateAsync({ type: "uint8array" });
}

const MANIFEST = JSON.stringify({
  name: "test-pkg",
  version: "1.0.0",
  description: "A test package",
  owners: ["test"],
  license: "MIT",
  dependencies: {},
  exports: ["MY_FUNC"],
  platforms: ["excel"],
});

const FUNCTIONS = JSON.stringify({
  MY_FUNC: {
    definition: "=LAMBDA(x, x+1)",
    description: "Adds one",
    arguments: { x: { description: "input", example: "1" } },
  },
});

describe("parseBundle", () => {
  it("extracts manifest and functions from a zip", async () => {
    const data = await makeZip({
      "manifest.json": MANIFEST,
      "functions.json": FUNCTIONS,
    });

    const bundle = await parseBundle(data);
    expect(bundle.manifest.name).toBe("test-pkg");
    expect(bundle.manifest.version).toBe("1.0.0");
    expect(bundle.functions.MY_FUNC.definition).toBe("=LAMBDA(x, x+1)");
  });

  it("throws when manifest.json is missing", async () => {
    const data = await makeZip({ "functions.json": FUNCTIONS });
    await expect(parseBundle(data)).rejects.toThrow("missing manifest.json");
  });

  it("throws when functions.json is missing", async () => {
    const data = await makeZip({ "manifest.json": MANIFEST });
    await expect(parseBundle(data)).rejects.toThrow("missing functions.json");
  });

  it("extracts platform-specific overrides", async () => {
    const excelFns = JSON.stringify({
      MY_FUNC: {
        definition: "=LAMBDA(x, _xlfn.SOMETHING(x))",
        description: "Excel version",
        arguments: {},
      },
    });

    const data = await makeZip({
      "manifest.json": MANIFEST,
      "functions.json": FUNCTIONS,
      "functions.excel.json": excelFns,
    });

    const bundle = await parseBundle(data);
    expect(bundle.platformFunctions?.excel?.MY_FUNC.definition).toContain(
      "_xlfn.SOMETHING",
    );
  });

  it("extracts README if present", async () => {
    const data = await makeZip({
      "manifest.json": MANIFEST,
      "functions.json": FUNCTIONS,
      "README.md": "# Test Package",
    });

    const bundle = await parseBundle(data);
    expect(bundle.readme).toBe("# Test Package");
  });
});
