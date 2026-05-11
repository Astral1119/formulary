import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type {
  PlatformAdapter,
  NamedFunction,
  ProjectMetadata,
  Lockfile,
  Manifest,
  FunctionDef,
} from "@formulary/core";
import { extract } from "../src/commands/extract.js";

// ─── Fake adapter ────────────────────────────────────────────────

class FakeAdapter implements PlatformAdapter {
  readonly platform = "excel" as const;

  constructor(
    private functions: NamedFunction[],
    private metadata: ProjectMetadata | null = null,
    private lockfile: Lockfile | null = null,
  ) {}

  async listFunctions(): Promise<NamedFunction[]> {
    return this.functions;
  }
  async readMetadata(): Promise<ProjectMetadata | null> {
    return this.metadata;
  }
  async readLockfile(): Promise<Lockfile | null> {
    return this.lockfile;
  }

  // Unused in extract
  async createFunction(): Promise<void> {}
  async updateFunction(): Promise<void> {}
  async deleteFunction(): Promise<void> {}
  async writeMetadata(): Promise<void> {}
  async writeLockfile(): Promise<void> {}
  async fetchJSON(): Promise<unknown> {
    return null;
  }
  async fetchBinary(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0);
  }
}

// ─── Test helpers ─────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "formulary-extract-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8"));
}

const HELLO: NamedFunction = {
  name: "HELLO",
  definition: 'LAMBDA(name, "Hello, " & name & "!")',
  description: "Greets someone",
  parameters: [{ name: "name", examples: [] }],
};

const DOUBLE: NamedFunction = {
  name: "DOUBLE",
  definition: "LAMBDA(x, x * 2)",
  description: "Doubles a number",
  parameters: [{ name: "x", examples: [] }],
};

const HASH: NamedFunction = {
  name: "HASH",
  definition: "LAMBDA(val, 12345)",
  description: "From charter dep",
  parameters: [{ name: "val", examples: [] }],
};

// ─── Tests ────────────────────────────────────────────────────────

describe("extract", () => {
  it("writes manifest.json and functions.json on first run", async () => {
    const adapter = new FakeAdapter([HELLO, DOUBLE]);
    await extract("", { output: tmpDir, adapter });

    const manifestPath = join(tmpDir, "manifest.json");
    const functionsPath = join(tmpDir, "functions.json");

    expect(existsSync(manifestPath)).toBe(true);
    expect(existsSync(functionsPath)).toBe(true);

    const functions = readJson<Record<string, FunctionDef>>(functionsPath);
    expect(Object.keys(functions)).toEqual(["HELLO", "DOUBLE"]);
    expect(functions.HELLO.definition).toContain("Hello, ");
  });

  it("filters out dependency functions using lockfile", async () => {
    const adapter = new FakeAdapter(
      [HELLO, DOUBLE, HASH],
      null,
      {
        packages: {
          charter: {
            version: "1.0.0",
            dependencies: [],
            functions: ["HASH"],
          },
        },
      },
    );

    await extract("", { output: tmpDir, adapter });

    const functions = readJson<Record<string, FunctionDef>>(
      join(tmpDir, "functions.json"),
    );
    expect(Object.keys(functions).sort()).toEqual(["DOUBLE", "HELLO"]);
    expect(functions.HASH).toBeUndefined();
  });

  it("preserves manifest.json on re-extract", async () => {
    const adapter = new FakeAdapter([HELLO]);

    // First run
    await extract("", { output: tmpDir, adapter });

    // Author edits manifest
    const manifestPath = join(tmpDir, "manifest.json");
    const manifest = readJson<Manifest>(manifestPath);
    manifest.description = "Author's custom description";
    manifest.version = "2.5.0";
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    // Re-extract
    await extract("", { output: tmpDir, adapter });

    // Manifest should be unchanged
    const after = readJson<Manifest>(manifestPath);
    expect(after.description).toBe("Author's custom description");
    expect(after.version).toBe("2.5.0");
  });

  it("regenerates manifest.json with --force", async () => {
    const adapter = new FakeAdapter([HELLO]);

    // First run
    await extract("", { output: tmpDir, adapter });

    // Author edits
    const manifestPath = join(tmpDir, "manifest.json");
    const manifest = readJson<Manifest>(manifestPath);
    manifest.description = "Custom";
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    // Force re-extract
    await extract("", { output: tmpDir, adapter, force: true });

    // Manifest description was reset
    const after = readJson<Manifest>(manifestPath);
    expect(after.description).toBe("");
  });

  it("regenerates functions.json on every run", async () => {
    let funcs: NamedFunction[] = [HELLO];
    const adapter = new FakeAdapter(funcs);

    await extract("", { output: tmpDir, adapter });
    const before = readJson<Record<string, FunctionDef>>(
      join(tmpDir, "functions.json"),
    );
    expect(Object.keys(before)).toEqual(["HELLO"]);

    // Add a function
    const adapter2 = new FakeAdapter([HELLO, DOUBLE]);
    await extract("", { output: tmpDir, adapter: adapter2 });

    const after = readJson<Record<string, FunctionDef>>(
      join(tmpDir, "functions.json"),
    );
    expect(Object.keys(after).sort()).toEqual(["DOUBLE", "HELLO"]);
  });

  it("writes to functions.{platform}.json with --platform", async () => {
    const adapter = new FakeAdapter([HELLO]);
    await extract("", { output: tmpDir, adapter, platform: "excel" });

    expect(existsSync(join(tmpDir, "functions.excel.json"))).toBe(true);
    expect(existsSync(join(tmpDir, "functions.json"))).toBe(false);
  });

  it("uses metadata from workbook for manifest stub", async () => {
    const meta: ProjectMetadata = {
      name: "my-cool-pkg",
      version: "0.5.0",
      description: "From workbook",
      license: "Apache-2.0",
      owners: "alice, bob",
      dependencies: { charter: ">=1.0.0" },
    };

    const adapter = new FakeAdapter([HELLO], meta);
    await extract("", { output: tmpDir, adapter });

    const manifest = readJson<Manifest>(join(tmpDir, "manifest.json"));
    expect(manifest.name).toBe("my-cool-pkg");
    expect(manifest.version).toBe("0.5.0");
    expect(manifest.description).toBe("From workbook");
    expect(manifest.license).toBe("Apache-2.0");
    expect(manifest.owners).toEqual(["alice", "bob"]);
    expect(manifest.dependencies).toEqual({ charter: ">=1.0.0" });
  });

  it("falls back to directory name when no metadata", async () => {
    const adapter = new FakeAdapter([HELLO]);
    await extract("", { output: tmpDir, adapter });

    const manifest = readJson<Manifest>(join(tmpDir, "manifest.json"));
    // Tmp dir name is something like "formulary-extract-test-XXXXX"
    expect(manifest.name).toMatch(/formulary-extract-test/);
    expect(manifest.version).toBe("0.1.0");
    expect(manifest.license).toBe("MIT");
  });

  it("populates exports from extracted functions", async () => {
    const adapter = new FakeAdapter([HELLO, DOUBLE]);
    await extract("", { output: tmpDir, adapter });

    const manifest = readJson<Manifest>(join(tmpDir, "manifest.json"));
    expect(manifest.exports.sort()).toEqual(["DOUBLE", "HELLO"]);
  });

  it("converts arguments to functions.json format", async () => {
    const fn: NamedFunction = {
      name: "GREET",
      definition: "LAMBDA(name, greeting, greeting & name)",
      description: "Custom greeting",
      parameters: [
        {
          name: "name",
          description: "Person to greet",
          examples: ["world"],
        },
        {
          name: "greeting",
          description: "Greeting word",
          examples: ["Hi"],
        },
      ],
    };

    const adapter = new FakeAdapter([fn]);
    await extract("", { output: tmpDir, adapter });

    const functions = readJson<Record<string, FunctionDef>>(
      join(tmpDir, "functions.json"),
    );
    expect(functions.GREET.arguments).toEqual({
      name: { description: "Person to greet", example: "world" },
      greeting: { description: "Greeting word", example: "Hi" },
    });
  });

  it("reports nothing when all functions are deps", async () => {
    const adapter = new FakeAdapter(
      [HASH],
      null,
      {
        packages: {
          charter: {
            version: "1.0.0",
            dependencies: [],
            functions: ["HASH"],
          },
        },
      },
    );

    await extract("", { output: tmpDir, adapter });

    // Nothing should have been written
    expect(existsSync(join(tmpDir, "functions.json"))).toBe(false);
    expect(existsSync(join(tmpDir, "manifest.json"))).toBe(false);
  });
});
