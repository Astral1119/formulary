/**
 * `formulary test` — run assay test suites against the active project.
 *
 * Reads test YAML files from the project's tests/ directory, builds a
 * temp workbook with the project's own functions + all dependencies
 * installed, and runs assay's `runSuite` against it.
 *
 * Uses assay as a library (not shelling out) so we get rich result
 * objects we can format however we like.
 */

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import type {
  Manifest,
  FunctionDef,
  Lockfile,
} from "@formulary/core";
import {
  RegistryClient,
  resolveDeps,
  pickVersion,
  resolveFunctions,
} from "@formulary/core";
import {
  loadTestSuite,
  runSuite,
  ExcelDriver,
  type TestSuite,
  type RunResult,
} from "assay";
import { ExcelAdapter } from "../adapter/excel-adapter.js";
import { fetchJSON, fetchBinary } from "../network.js";
import { parseBundle } from "../bundle.js";
import { getActive } from "../projects.js";

const REGISTRY_BASE =
  process.env.FORMULARY_REGISTRY ??
  "https://raw.githubusercontent.com/Astral1119/formulary-registry/main";

interface TestOptions {
  /** Override the project directory. */
  dir?: string;
  /** Comma-separated tag filter. */
  tags?: string;
}

export async function test(options: TestOptions = {}): Promise<void> {
  const dir = await resolveTestDir(options);
  const manifest = JSON.parse(
    await readFile(join(dir, "manifest.json"), "utf8"),
  ) as Manifest;
  const functions = JSON.parse(
    await readFile(join(dir, "functions.json"), "utf8"),
  ) as Record<string, FunctionDef>;

  console.log(`Testing ${manifest.name}@${manifest.version}`);

  // Find test files
  const testsDir = join(dir, "tests");
  if (!existsSync(testsDir)) {
    console.log("  no tests/ directory — nothing to test");
    return;
  }

  const files = (await readdir(testsDir))
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort();

  if (files.length === 0) {
    console.log("  no test files in tests/ — nothing to test");
    return;
  }

  console.log(`  ${files.length} test file${files.length === 1 ? "" : "s"}`);

  // Build a temp workbook with the project's functions + deps installed
  const workbookPath = await buildTestWorkbook(dir, manifest, functions);
  console.log(`  workbook: ${workbookPath}\n`);

  try {
    const driver = new ExcelDriver(false, workbookPath);
    await driver.init();

    let totalPassed = 0;
    let totalFailed = 0;
    let totalRecorded = 0;
    const failedDetails: Array<{ file: string; result: RunResult }> = [];

    for (const file of files) {
      const filePath = join(testsDir, file);
      const suite = loadTestSuite(filePath);
      const result = await runSuiteWithDriver(suite, driver, options.tags);

      totalPassed += result.summary.passed;
      totalFailed += result.summary.failed;
      totalRecorded += result.summary.recorded;

      const passEmoji = result.summary.failed === 0 ? "✓" : "✕";
      console.log(
        `  ${passEmoji} ${file}: ${result.summary.passed}/${result.summary.total} passed` +
          (result.summary.failed > 0 ? `, ${result.summary.failed} failed` : "") +
          (result.summary.recorded > 0 ? `, ${result.summary.recorded} recorded` : ""),
      );

      if (result.summary.failed > 0) {
        failedDetails.push({ file, result });
      }
    }

    await driver.destroy();

    // Print failures with detail
    if (failedDetails.length > 0) {
      console.log("\nFailures:");
      for (const { file, result } of failedDetails) {
        for (const r of result.results) {
          if (r.passed !== false) continue;
          console.log(`\n  ${file} > ${r.test.name}`);
          console.log(`    formula:  ${r.test.formula}`);
          if (r.error) {
            console.log(`    error:    ${r.error}`);
          } else {
            console.log(`    expected: ${formatGrid(r.expected)}`);
            console.log(`    actual:   ${formatGrid(r.actual)}`);
          }
        }
      }
    }

    const total = totalPassed + totalFailed + totalRecorded;
    console.log(
      `\n${totalPassed}/${total} passed` +
        (totalFailed > 0 ? `, ${totalFailed} failed` : "") +
        (totalRecorded > 0 ? `, ${totalRecorded} recorded` : ""),
    );

    if (totalFailed > 0) {
      process.exit(1);
    }
  } finally {
    // Clean up workbook
    try {
      const { unlinkSync } = await import("node:fs");
      unlinkSync(workbookPath);
    } catch {
      // ignore
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────

async function resolveTestDir(options: TestOptions): Promise<string> {
  if (options.dir) return resolve(options.dir);

  const active = getActive();
  if (active && active.target.kind === "directory") {
    return active.target.path;
  }

  const cwd = process.cwd();
  if (existsSync(join(cwd, "manifest.json"))) {
    return cwd;
  }

  throw new Error(
    "no project directory specified.\n" +
      "  pass a directory or set an active project with `formulary use <name>`",
  );
}

/**
 * Build a fresh xlsx workbook with the project's functions + all
 * dependencies installed. Returns the workbook path.
 */
async function buildTestWorkbook(
  _projectDir: string,
  manifest: Manifest,
  functions: Record<string, FunctionDef>,
): Promise<string> {
  const tmpDir = mkdtempSync(join(tmpdir(), "formulary-test-"));
  const xlsxPath = join(tmpDir, `${manifest.name}-test.xlsx`);

  const adapter = await ExcelAdapter.create();

  // 1. Install dependencies from the registry (recursive)
  const registry = new RegistryClient(REGISTRY_BASE);
  const fetchMeta = (name: string) =>
    fetchJSON(registry.packageMetaUrl(name)).then((d) =>
      registry.parsePackageMeta(d),
    );

  const lock: Lockfile = { packages: {} };
  const directDeps = manifest.dependencies ?? {};

  // Resolve transitive deps for each direct dep
  for (const [depName, spec] of Object.entries(directDeps)) {
    const meta = await fetchMeta(depName);
    const picked = pickVersion(meta, spec, "excel");
    if (!picked) {
      throw new Error(
        `cannot resolve ${depName}${spec ? ` (${spec})` : ""}`,
      );
    }

    const transitive = await resolveDeps(
      depName,
      picked.version,
      fetchMeta,
      lock,
      "excel",
    );

    // Install transitive deps + this dep itself
    const toInstall = [
      ...transitive,
      { name: depName, version: picked.version, meta: picked.meta },
    ];

    for (const pkg of toInstall) {
      const fpkgData = await fetchBinary(
        registry.artifactUrl(pkg.meta.artifact),
      );
      const bundle = await parseBundle(fpkgData);
      const fns = resolveFunctions(bundle, "excel");
      for (const [name, def] of Object.entries(fns)) {
        await adapter.createFunction({
          name,
          definition: def.definition,
          description: def.description,
        });
      }
      lock.packages[pkg.name] = {
        version: pkg.version,
        dependencies: Object.keys(pkg.meta.dependencies ?? {}),
        functions: Object.keys(fns),
      };
    }
  }

  // 2. Install the project's own functions
  for (const [name, def] of Object.entries(functions)) {
    await adapter.createFunction({
      name,
      definition: def.definition,
      description: def.description,
    });
  }

  // 3. Save
  const buf = await adapter.save();
  await writeFile(xlsxPath, buf);

  return xlsxPath;
}

/**
 * Run a single suite via assay's runSuite. Wraps the result so we can
 * pass through tag filtering.
 */
async function runSuiteWithDriver(
  suite: TestSuite,
  driver: ExcelDriver,
  tagsRaw?: string,
): Promise<RunResult> {
  const tags = tagsRaw
    ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean)
    : undefined;
  return runSuite(suite, [driver], tags ? { tags } : undefined);
}

function formatGrid(grid: unknown): string {
  if (grid === undefined || grid === null) return "(no value)";
  if (Array.isArray(grid)) {
    if (grid.length === 1 && Array.isArray(grid[0]) && grid[0].length === 1) {
      return JSON.stringify(grid[0][0]);
    }
    return JSON.stringify(grid);
  }
  return JSON.stringify(grid);
}
