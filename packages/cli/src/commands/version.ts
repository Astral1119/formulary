/**
 * `formulary version <bump|set>` — manipulate the active project's version.
 *
 *   formulary version           Show the current version
 *   formulary version bump major
 *   formulary version bump minor
 *   formulary version bump patch
 *   formulary version set 1.2.3
 *
 * Operates on the active project's manifest.json (directory mode) or
 * the workbook's metadata sheet.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import type { Manifest } from "@formulary/core";
import { parseSemVer } from "@formulary/core";
import { getActive } from "../projects.js";
import { ExcelAdapter } from "../adapter/excel-adapter.js";

type BumpKind = "major" | "minor" | "patch";

// Permissive: X.Y.Z optionally followed by a pre-release suffix.
// Matches the registry validator's accepted format.
const SEMVER_LIKE = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;

export async function versionShow(): Promise<void> {
  const { version, name } = await readActiveProjectVersion();
  console.log(`${name}@${version}`);
}

export async function versionBump(kind: BumpKind): Promise<void> {
  const { current, name, write } = await readActiveProjectVersionWriter();
  const next = bump(current, kind);
  await write(next);
  console.log(`✓ ${name}: ${current} → ${next}`);
}

export async function versionSet(target: string): Promise<void> {
  if (!SEMVER_LIKE.test(target)) {
    throw new Error(
      `"${target}" is not a valid version. Use X.Y.Z or X.Y.Z-suffix`,
    );
  }
  const { current, name, write } = await readActiveProjectVersionWriter();
  await write(target);
  console.log(`✓ ${name}: ${current} → ${target}`);
}

// ─── Helpers ──────────────────────────────────────────────────────

function bump(version: string, kind: BumpKind): string {
  const v = parseSemVer(version);
  if (!v) {
    throw new Error(`current version "${version}" is not valid semver`);
  }
  switch (kind) {
    case "major":
      return `${v.major + 1}.0.0`;
    case "minor":
      return `${v.major}.${v.minor + 1}.0`;
    case "patch":
      return `${v.major}.${v.minor}.${v.patch + 1}`;
  }
}

interface VersionReader {
  current: string;
  name: string;
  write: (next: string) => Promise<void>;
}

async function readActiveProjectVersion(): Promise<{
  version: string;
  name: string;
}> {
  const r = await readActiveProjectVersionWriter();
  return { version: r.current, name: r.name };
}

async function readActiveProjectVersionWriter(): Promise<VersionReader> {
  const active = getActive();
  if (!active) {
    throw new Error(
      "no active project. run `formulary use <name>` or pass a directory",
    );
  }

  if (active.target.kind === "directory") {
    const manifestPath = join(active.target.path, "manifest.json");
    const manifest = JSON.parse(
      await readFile(manifestPath, "utf8"),
    ) as Manifest;
    return {
      current: manifest.version,
      name: manifest.name,
      write: async (next) => {
        manifest.version = next;
        await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
      },
    };
  }

  if (active.target.kind === "xlsx") {
    const data = await readFile(active.target.path);
    const adapter = await ExcelAdapter.open(new Uint8Array(data));
    const meta = await adapter.readMetadata();
    if (!meta || typeof meta.name !== "string") {
      throw new Error("workbook has no manifest sheet — initialize with `formulary new` first");
    }
    const xlsxPath = active.target.path;
    return {
      current: typeof meta.version === "string" ? meta.version : "0.0.0",
      name: meta.name,
      write: async (next) => {
        meta.version = next;
        await adapter.writeMetadata(meta);
        await writeFile(xlsxPath, await adapter.save());
      },
    };
  }

  throw new Error(
    "version bump for gsheets projects not yet supported (use `formulary` Project tab in the add-in)",
  );
}
