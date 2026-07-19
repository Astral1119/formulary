/**
 * Publish a package to the Formulary registry.
 *
 * Two layers:
 *   1. Registry update generation (in core) — produces the index.json,
 *      meta.json, and artifact mutations needed
 *   2. Backend application — applies them. Currently GitHub PR via the
 *      `gh` CLI; the add-in uses a REST API backend instead.
 *
 * The pure logic (preflight checks, owner sync, exfiltration check)
 * lives in @formulary/core so the add-in and CLI share it.
 */

import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  existsSync,
  rmSync,
  mkdtempSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import type {
  Manifest,
  RegistryUpdate,
  RegistryBackend,
  PreflightCheck,
} from "@formulary/core";
import {
  buildRegistryUpdate,
  runPreflightChecks,
  syncManifestForPublish,
} from "@formulary/core";
import { parseBundle } from "../bundle.js";
import { pack as packDir } from "./pack.js";

const REGISTRY_OWNER = "Astral1119";
const REGISTRY_REPO = "formulary-registry";
const REGISTRY_FULL = `${REGISTRY_OWNER}/${REGISTRY_REPO}`;

// ─── Public API ───────────────────────────────────────────────────

interface PublishOptions {
  dryRun?: boolean;
  /** Skip blocking on preflight failures (still warns). */
  force?: boolean;
}

export async function publish(
  source: string,
  options: PublishOptions = {},
): Promise<void> {
  // 1. Get or create the .fpkg
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

  // 2. Parse the bundle
  const fpkgData = await readFile(fpkgPath);
  const bundle = await parseBundle(fpkgData);
  let manifest = bundle.manifest;
  const functions = bundle.functions;

  // 3. Determine publisher (always — even for dry run, so the preview
  //    accurately reflects what a real publish would do)
  const username = ghUser();

  // 4. Sync owners + exports
  manifest = syncManifestForPublish(manifest, functions, username);

  // 5. Run preflight checks
  const checks = runPreflightChecks(manifest, functions);
  printChecks(checks);
  const failed = checks.filter((c) => !c.ok);
  if (failed.length > 0 && !options.force) {
    throw new Error(
      `Preflight failed (${failed.length} check${failed.length === 1 ? "" : "s"}).\n` +
        `Fix the issues above, or pass --force to publish anyway.`,
    );
  }

  // 6. If sync changed the manifest, repack so the .fpkg matches what
  //    we're claiming. Skip during dry run — we don't want side effects
  //    on the source directory.
  const manifestChanged =
    JSON.stringify(manifest) !== JSON.stringify(bundle.manifest);
  if (manifestChanged && !options.dryRun) {
    fpkgPath = await repackWithSyncedManifest(source, manifest);
  }

  // 7. Hash and build the update
  const updatedData = await readFile(fpkgPath);
  const hash = createHash("sha256").update(updatedData).digest("hex");
  const integrity = `sha256:${hash}`;

  const update = buildRegistryUpdate(
    manifest,
    { kind: "path", path: fpkgPath },
    integrity,
  );

  console.log(`\nPublishing ${manifest.name}@${manifest.version}`);
  console.log(`  Functions: ${manifest.exports.join(", ")}`);
  console.log(`  Platforms: ${manifest.platforms.join(", ")}`);
  console.log(`  Owners:    ${manifest.owners.join(", ") || "(none)"}`);
  console.log(`  Integrity: ${integrity}`);

  if (options.dryRun) {
    console.log("\n(dry run — no changes made)");
    return;
  }

  // 8. Apply via backend
  const backend = new GitHubPRBackend();
  const result = await backend.apply(update);
  console.log(`\n✓ ${result}`);
}

// ─── Helpers ──────────────────────────────────────────────────────

function printChecks(checks: PreflightCheck[]): void {
  console.log("\nPre-publish checks:");
  for (const c of checks) {
    const mark = c.ok ? "✓" : "✕";
    const detail = c.detail ? ` — ${c.detail}` : "";
    console.log(`  ${mark} ${c.label}${detail}`);
  }
}

/**
 * Re-pack the source directory into a fresh .fpkg with the synced
 * manifest. Writes back to the source directory's manifest.json so
 * subsequent publishes are consistent.
 *
 * Used when preflight modified owners or exports. Not called during
 * dry-run.
 */
async function repackWithSyncedManifest(
  source: string,
  manifest: Manifest,
): Promise<string> {
  if (source.endsWith(".fpkg")) {
    throw new Error(
      "Cannot sync owners/exports into a pre-built .fpkg. " +
        "Pass a source directory to formulary publish instead.",
    );
  }

  const sourceDir = resolve(source);
  const manifestPath = join(sourceDir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  const tmpDir = mkdtempSync(join(tmpdir(), "formulary-repack-"));
  const outPath = join(tmpDir, `${manifest.name}-${manifest.version}.fpkg`);
  await packDir(sourceDir, outPath);
  return outPath;
}

// ─── GitHub PR backend ────────────────────────────────────────────

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

      // Force-create the branch from main, regardless of any leftover
      // state from previous attempts.
      git(forkPath, "checkout", "-B", branch);
      git(forkPath, "add", "-A");
      git(forkPath, "commit", "-m", `Add ${update.manifest.name} v${update.version}`);
      git(forkPath, "push", "--force", "origin", branch);

      // Try to create the PR; if one already exists for this branch,
      // return its URL instead of failing.
      try {
        return createPR(branch, update.manifest, username);
      } catch (e) {
        const msg = (e as Error).message;
        if (
          msg.includes("already exists") ||
          msg.includes("A pull request")
        ) {
          const existing = findExistingPR(username, branch);
          if (existing) return existing;
        }
        throw e;
      }
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
    if (update.fpkg.kind !== "path") {
      throw new Error("GitHubPRBackend requires fpkg.kind === 'path'");
    }
    copyFileSync(update.fpkg.path, join(dir, artifactPath));
  }
}

// ─── Git/GitHub helpers ───────────────────────────────────────────

function gh(...args: string[]): string {
  try {
    return execSync(`gh ${args.join(" ")}`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (e) {
    const err = e as { stderr?: Buffer; message?: string };
    const stderr = err.stderr?.toString() ?? "";
    throw new Error(`gh ${args[0]} failed: ${stderr || err.message}`);
  }
}

function git(cwd: string, ...args: string[]): string {
  try {
    return execSync(`git ${args.join(" ")}`, {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (e) {
    const err = e as { stderr?: Buffer; message?: string };
    const stderr = err.stderr?.toString() ?? "";
    throw new Error(`git ${args[0]} failed: ${stderr || err.message}`);
  }
}

function ghUser(): string {
  try {
    return gh("api", "user", "-q", ".login");
  } catch {
    throw new Error(
      "GitHub CLI not authenticated. Run:\n  gh auth login",
    );
  }
}

function ensureFork(username: string): void {
  try {
    gh("repo", "view", `${username}/${REGISTRY_REPO}`, "--json", "name");
  } catch {
    console.log("Creating registry fork...");
    gh("repo", "fork", REGISTRY_FULL, "--clone=false");
    // Forks take a moment to be ready
    setTimeoutSync(2000);
  }
}

function cloneAndSync(forkPath: string, username: string): void {
  console.log("Syncing fork with upstream...");
  try {
    gh(
      "api",
      "--method", "POST",
      `/repos/${username}/${REGISTRY_REPO}/merge-upstream`,
      "-f", "branch=main",
    );
  } catch {
    // already up to date
  }
  console.log("Cloning fork...");
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
    "--body", JSON.stringify(body),
  );
}

function findExistingPR(username: string, branch: string): string | null {
  try {
    const out = gh(
      "pr", "list",
      "--repo", REGISTRY_FULL,
      "--head", `${username}:${branch}`,
      "--state", "open",
      "--json", "url",
      "--jq", ".[0].url",
    );
    return out || null;
  } catch {
    return null;
  }
}

function setTimeoutSync(ms: number): void {
  // Crude blocking sleep for the rare cases (fork creation lag).
  const start = Date.now();
  while (Date.now() - start < ms) {
    // busy wait — this only runs once on first publish
  }
}
