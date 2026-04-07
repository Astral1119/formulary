/**
 * Publish a package to the Formulary registry.
 *
 * Two layers:
 *   1. Registry update generation (agnostic) — computes what index.json,
 *      meta.json, and artifact changes are needed
 *   2. Backend application — applies those changes. Currently GitHub PR,
 *      but the interface is swappable.
 */

import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Manifest } from "@formulary/core";
import { validateManifest } from "@formulary/core";
import { parseBundle } from "../bundle.js";
import { pack as packDir } from "./pack.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

// ─── Registry update (backend-agnostic) ───────────────────────────

/** Describes all mutations needed to publish a version to the registry. */
export interface RegistryUpdate {
  manifest: Manifest;
  version: string;
  integrity: string;
  fpkgPath: string;
  /** Relative path where the artifact should live in the registry. */
  artifactPath: string;
  /** Updated index entry for this package. */
  indexEntry: {
    latest: string;
    description: string;
    platforms: string[];
  };
  /** Updated version entry for meta.json. */
  versionEntry: Record<string, unknown>;
}

function buildRegistryUpdate(
  manifest: Manifest,
  fpkgPath: string,
  integrity: string,
): RegistryUpdate {
  const { name, version } = manifest;
  const artifactPath = `packages/${name}/${version}/${name}-${version}.fpkg`;

  return {
    manifest,
    version,
    integrity,
    fpkgPath,
    artifactPath,
    indexEntry: {
      latest: version,
      description: manifest.description,
      platforms: manifest.platforms,
    },
    versionEntry: {
      artifact: artifactPath,
      integrity,
      dependencies: manifest.dependencies ?? {},
      ...(manifest.platformDependencies
        ? { platformDependencies: manifest.platformDependencies }
        : {}),
      exports: manifest.exports,
      platforms: manifest.platforms,
    },
  };
}

// ─── Backend interface ────────────────────────────────────────────

/**
 * A registry backend applies a RegistryUpdate to a registry.
 * Currently only GitHub PR, but designed so an API backend or
 * local-file backend can be swapped in.
 */
interface RegistryBackend {
  apply(update: RegistryUpdate): Promise<string>; // returns result URL or message
}

// ─── GitHub PR backend ────────────────────────────────────────────

import { execSync } from "node:child_process";
import {
  writeFileSync,
  mkdirSync,
  copyFileSync,
  existsSync,
  rmSync,
} from "node:fs";

const REGISTRY_OWNER = "Astral1119";
const REGISTRY_REPO = "formulary-registry";
const REGISTRY_FULL = `${REGISTRY_OWNER}/${REGISTRY_REPO}`;

class GitHubPRBackend implements RegistryBackend {
  async apply(update: RegistryUpdate): Promise<string> {
    const username = ghUser();
    console.log(`  GitHub user: ${username}`);

    const tmpDir = mkdtempSync(join(tmpdir(), "formulary-publish-"));
    const forkPath = join(tmpDir, "registry");

    try {
      ensureFork(username);
      cloneAndSync(forkPath, username);

      this.applyToDir(forkPath, update);

      const branch = `publish/${update.manifest.name}-${update.version}`;
      git(forkPath, "checkout", "-b", branch);
      git(forkPath, "add", ".");
      git(forkPath, "commit", "-m", `Add ${update.manifest.name} v${update.version}`);
      git(forkPath, "push", "--force-with-lease", "origin", branch);

      return createPR(branch, update.manifest, username);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  private applyToDir(dir: string, update: RegistryUpdate): void {
    const { manifest, artifactPath, indexEntry, versionEntry } = update;
    const { name } = manifest;

    // index.json
    const indexPath = join(dir, "index.json");
    const index = existsSync(indexPath)
      ? JSON.parse(readFileSync(indexPath, "utf8"))
      : { packages: {} };
    if (!index.packages) index.packages = {};
    index.packages[name] = indexEntry;
    writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");

    // meta.json
    const metaDir = join(dir, "packages", name);
    const metaPath = join(metaDir, "meta.json");
    mkdirSync(metaDir, { recursive: true });
    const meta = existsSync(metaPath)
      ? JSON.parse(readFileSync(metaPath, "utf8"))
      : { name, owners: manifest.owners, versions: {} };
    meta.owners = manifest.owners;
    meta.versions[manifest.version] = versionEntry;
    writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");

    // artifact
    const artifactDir = join(dir, ...artifactPath.split("/").slice(0, -1));
    mkdirSync(artifactDir, { recursive: true });
    copyFileSync(update.fpkgPath, join(dir, artifactPath));
  }
}

// ─── Public API ───────────────────────────────────────────────────

interface PublishOptions {
  dryRun?: boolean;
}

export async function publish(
  source: string,
  options: PublishOptions = {},
): Promise<void> {
  // Get or create .fpkg
  let fpkgPath: string;
  if (source.endsWith(".fpkg")) {
    fpkgPath = resolve(source);
  } else {
    console.log("Packing...");
    const manifestData = JSON.parse(
      readFileSync(join(resolve(source), "manifest.json"), "utf8"),
    ) as Manifest;
    const tmpDir = mkdtempSync(join(tmpdir(), "formulary-pack-"));
    const outPath = join(tmpDir, `${manifestData.name}-${manifestData.version}.fpkg`);
    await packDir(resolve(source), outPath);
    fpkgPath = outPath;
  }

  // Parse, validate, hash
  const fpkgData = await readFile(fpkgPath);
  const bundle = await parseBundle(fpkgData);
  const manifest = bundle.manifest;

  const errors = validateManifest(manifest);
  if (errors.length > 0) {
    throw new Error(`Invalid manifest:\n  ${errors.join("\n  ")}`);
  }

  const hash = createHash("sha256").update(fpkgData).digest("hex");
  const integrity = `sha256:${hash}`;

  // Build the update
  const update = buildRegistryUpdate(manifest, fpkgPath, integrity);

  console.log(`\nPublishing ${manifest.name}@${manifest.version}`);
  console.log(`  Functions: ${manifest.exports.join(", ")}`);
  console.log(`  Platforms: ${manifest.platforms.join(", ")}`);
  console.log(`  Integrity: ${integrity}`);

  if (options.dryRun) {
    console.log("\n(dry run — no changes made)");
    return;
  }

  // Apply via backend
  const backend = new GitHubPRBackend();
  const result = await backend.apply(update);
  console.log(`\n✓ ${result}`);
}

// ─── Git/GitHub helpers ───────────────────────────────────────────

function gh(...args: string[]): string {
  try {
    return execSync(`gh ${args.join(" ")}`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (e: any) {
    throw new Error(`gh ${args[0]} failed: ${e.stderr || e.message}`);
  }
}

function git(cwd: string, ...args: string[]): string {
  try {
    return execSync(`git ${args.join(" ")}`, {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (e: any) {
    throw new Error(`git ${args[0]} failed: ${e.stderr || e.message}`);
  }
}

function ghUser(): string {
  try {
    return gh("api", "user", "-q", ".login");
  } catch {
    throw new Error("GitHub CLI not authenticated. Run:\n  gh auth login");
  }
}

function ensureFork(username: string): void {
  try {
    gh("repo", "view", `${username}/${REGISTRY_REPO}`, "--json", "name");
  } catch {
    console.log("Creating registry fork...");
    gh("repo", "fork", REGISTRY_FULL, "--clone=false");
  }
}

function cloneAndSync(forkPath: string, username: string): void {
  console.log("Cloning registry...");
  try {
    gh("api", `/repos/${username}/${REGISTRY_REPO}/merge-upstream`, "-f", "branch=main");
  } catch {
    // already up to date
  }
  git(".", "clone", `https://github.com/${username}/${REGISTRY_REPO}.git`, forkPath);
}

function createPR(branch: string, manifest: Manifest, username: string): string {
  const deps = Object.entries(manifest.dependencies ?? {});
  const depsStr = deps.length
    ? deps.map(([n, s]) => `- ${n} ${s}`).join("\n")
    : "None";

  const body = `## ${manifest.name} v${manifest.version}

${manifest.description}

**Platforms:** ${manifest.platforms.join(", ")}
**Exports:** ${manifest.exports.join(", ")}

**Dependencies:**
${depsStr}

---
_Published with \`formulary publish\`_`;

  return gh(
    "pr", "create",
    "--repo", REGISTRY_FULL,
    "--head", `${username}:${branch}`,
    "--title", `${manifest.name} v${manifest.version}`,
    "--body", body,
  );
}
