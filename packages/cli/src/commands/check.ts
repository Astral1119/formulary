/**
 * `formulary check` — validate the current project's manifest and
 * functions without publishing.
 *
 * Reads the active project (or an explicit directory), runs the same
 * preflight checks the publish flow uses, and prints the results.
 *
 * Exits 1 if any check fails so it can be used in CI.
 */

import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import type { Manifest, FunctionDef } from "@formulary/core";
import { runPreflightChecks } from "@formulary/core";
import { getActive } from "../projects.js";

interface CheckOptions {
  /** Override the directory to check (defaults to active project). */
  dir?: string;
}

export async function check(options: CheckOptions = {}): Promise<void> {
  const dir = await resolveCheckDir(options);

  const manifest = JSON.parse(
    await readFile(join(dir, "manifest.json"), "utf8"),
  ) as Manifest;
  const functions = JSON.parse(
    await readFile(join(dir, "functions.json"), "utf8"),
  ) as Record<string, FunctionDef>;

  console.log(`Checking ${manifest.name}@${manifest.version}`);
  console.log(`  ${dir}\n`);

  const checks = runPreflightChecks(manifest, functions);
  let failed = 0;
  for (const c of checks) {
    const mark = c.ok ? "✓" : "✕";
    const detail = c.detail ? ` — ${c.detail}` : "";
    console.log(`  ${mark} ${c.label}${detail}`);
    if (!c.ok) failed++;
  }

  if (failed > 0) {
    console.error(`\n${failed} check${failed === 1 ? "" : "s"} failed`);
    process.exit(1);
  }
  console.log(`\n✓ all checks passed`);
}

async function resolveCheckDir(options: CheckOptions): Promise<string> {
  if (options.dir) return resolve(options.dir);

  const active = getActive();
  if (active && active.target.kind === "directory") {
    return active.target.path;
  }

  // Fall back to cwd if it has a manifest
  const cwd = process.cwd();
  try {
    await readFile(join(cwd, "manifest.json"));
    return cwd;
  } catch {
    throw new Error(
      "no project directory specified.\n" +
        "  pass a directory or set an active project with `formulary use <name>`",
    );
  }
}
