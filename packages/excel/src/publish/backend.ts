/**
 * GitHub REST API backend for publishing from the browser.
 *
 * Implements RegistryBackend (from @formulary/core). Uses the Git Data API
 * to commit multiple files in one commit, no clone required.
 *
 * Flow:
 *   1. Ensure user has a fork of the registry
 *   2. Sync the fork with upstream
 *   3. Read existing index.json + meta.json (to merge updates)
 *   4. Compute updated content
 *   5. Create blobs (one per file)
 *   6. Create a tree extending the current main tree
 *   7. Create a commit
 *   8. Create a branch ref pointing at the commit
 *   9. Open a PR back to the upstream
 */

import type { RegistryBackend, RegistryUpdate } from "@formulary/core";
import { GitHubClient } from "./github.js";

const REGISTRY_OWNER = "Astral1119";
const REGISTRY_REPO = "formulary-registry";

export class GitHubApiBackend implements RegistryBackend {
  constructor(private client: GitHubClient) {}

  async apply(update: RegistryUpdate): Promise<string> {
    if (update.fpkg.kind !== "bytes") {
      throw new Error("GitHubApiBackend requires fpkg.kind === 'bytes'");
    }
    const fpkgBytes = update.fpkg.data;

    const user = await this.client.getUser();
    const username = user.login;

    // 1. Ensure fork exists
    const hasFork = await this.client.hasRepo(username, REGISTRY_REPO);
    if (!hasFork) {
      await this.client.createFork(REGISTRY_OWNER, REGISTRY_REPO);
      // Forks take a moment to be ready; wait briefly
      await new Promise((r) => setTimeout(r, 2000));
    }

    // 2. Sync fork with upstream
    await this.client.syncFork(username, REGISTRY_REPO, "main");

    // 3. Get the current main commit + tree
    const mainRef = await this.client.getRef(
      username,
      REGISTRY_REPO,
      "heads/main",
    );
    const mainCommit = await this.client.getCommit(
      username,
      REGISTRY_REPO,
      mainRef.object.sha,
    );
    const baseTreeSha = mainCommit.tree.sha;

    // 4. Read existing files we need to merge
    const { manifest } = update;
    const indexPath = "index.json";
    const metaPath = `packages/${manifest.name}/meta.json`;

    const existingIndexRaw = await this.client.getFileContent(
      username,
      REGISTRY_REPO,
      indexPath,
      "main",
    );
    const existingMetaRaw = await this.client.getFileContent(
      username,
      REGISTRY_REPO,
      metaPath,
      "main",
    );

    // 5. Compute updated content
    const updatedIndex = mergeIndex(existingIndexRaw, manifest.name, update.indexEntry);
    const updatedMeta = mergeMeta(
      existingMetaRaw,
      manifest.name,
      manifest.owners,
      manifest.version,
      update.versionEntry,
    );

    // 6. Create blobs for each file
    const indexBlob = await this.client.createBlob(username, REGISTRY_REPO, {
      kind: "text",
      data: updatedIndex,
    });
    const metaBlob = await this.client.createBlob(username, REGISTRY_REPO, {
      kind: "text",
      data: updatedMeta,
    });
    const fpkgBlob = await this.client.createBlob(username, REGISTRY_REPO, {
      kind: "bytes",
      data: fpkgBytes,
    });

    // 7. Create a new tree
    const tree = await this.client.createTree(
      username,
      REGISTRY_REPO,
      baseTreeSha,
      [
        { path: indexPath, mode: "100644", type: "blob", sha: indexBlob.sha },
        { path: metaPath, mode: "100644", type: "blob", sha: metaBlob.sha },
        {
          path: update.artifactPath,
          mode: "100644",
          type: "blob",
          sha: fpkgBlob.sha,
        },
      ],
    );

    // 8. Create the commit
    const commit = await this.client.createCommit(
      username,
      REGISTRY_REPO,
      `Add ${manifest.name} v${manifest.version}`,
      tree.sha,
      mainRef.object.sha,
    );

    // 9. Create or update the branch ref. Force-update covers the
    // case where a previous failed attempt left the branch in the fork.
    const branchName = `publish/${manifest.name}-${manifest.version}`;
    await this.client.upsertRef(
      username,
      REGISTRY_REPO,
      `refs/heads/${branchName}`,
      commit.sha,
    );

    // 10. Open the PR (or return existing one if a PR for this branch is already open)
    try {
      const pr = await this.client.createPR(
        REGISTRY_OWNER,
        REGISTRY_REPO,
        `${manifest.name} v${manifest.version}`,
        buildPRBody(manifest),
        `${username}:${branchName}`,
        "main",
      );
      return pr.html_url;
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("422") && msg.includes("pull request already exists")) {
        // Find and return the existing PR URL
        const existing = await this.client.findPRByHead(
          REGISTRY_OWNER,
          REGISTRY_REPO,
          `${username}:${branchName}`,
        );
        if (existing) return existing.html_url;
      }
      throw err;
    }
  }
}

// ─── File merging ─────────────────────────────────────────────────

function mergeIndex(
  existing: string | null,
  name: string,
  entry: RegistryUpdate["indexEntry"],
): string {
  const index = existing
    ? JSON.parse(existing)
    : { packages: {} as Record<string, unknown> };
  if (!index.packages) index.packages = {};
  index.packages[name] = entry;
  return JSON.stringify(index, null, 2) + "\n";
}

function mergeMeta(
  existing: string | null,
  name: string,
  owners: string[],
  version: string,
  versionEntry: RegistryUpdate["versionEntry"],
): string {
  const meta = existing
    ? JSON.parse(existing)
    : { name, owners, versions: {} as Record<string, unknown> };
  meta.owners = owners;
  if (!meta.versions) meta.versions = {};
  meta.versions[version] = versionEntry;
  return JSON.stringify(meta, null, 2) + "\n";
}

function buildPRBody(manifest: RegistryUpdate["manifest"]): string {
  const deps = Object.entries(manifest.dependencies ?? {});
  const depsStr = deps.length
    ? deps.map(([n, s]) => `- ${n} ${s}`).join("\n")
    : "None";

  return `## ${manifest.name} v${manifest.version}

${manifest.description}

**Platforms:** ${manifest.platforms.join(", ")}
**Exports:** ${manifest.exports.join(", ")}

**Dependencies:**
${depsStr}

---
_Published from the Formulary Excel add-in_`;
}
