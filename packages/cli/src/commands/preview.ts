/**
 * `formulary preview` — install the active project into a temporary
 * workbook for hands-on inspection. Optionally tear down.
 *
 * Two phases:
 *   formulary preview                     - create temp workbook with
 *                                            current project's functions
 *                                            and deps installed; print path
 *   formulary preview --teardown          - delete the most recent preview
 *
 * The preview is tracked in the active project entry so subsequent
 * commands know it exists. State stored in ~/.formulary/previews.json
 * keyed by project name.
 */

import { writeFile, readFile, mkdir } from "node:fs/promises";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdtempSync,
  mkdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir, homedir } from "node:os";
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
import { ExcelAdapter } from "../adapter/excel-adapter.js";
import { fetchJSON, fetchBinary } from "../network.js";
import { parseBundle } from "../bundle.js";
import { getActive, type ProjectTarget } from "../projects.js";

const REGISTRY_BASE =
  process.env.FORMULARY_REGISTRY ??
  "https://raw.githubusercontent.com/Astral1119/formulary-registry/main";

const PREVIEW_STATE_FILE = join(homedir(), ".formulary", "previews.json");

interface PreviewState {
  /** project name → workbook path */
  active: Record<string, string>;
}

interface PreviewOptions {
  teardown?: boolean;
}

export async function preview(options: PreviewOptions = {}): Promise<void> {
  const active = getActive();
  if (!active) {
    throw new Error(
      "no active project. run `formulary new` or `formulary use <name>` first",
    );
  }

  if (options.teardown) {
    return doTeardown(active.name);
  }
  return doCreate(active.name, active.target);
}

// ─── Create ───────────────────────────────────────────────────────

async function doCreate(
  projectName: string,
  target: ProjectTarget,
): Promise<void> {
  if (target.kind !== "directory") {
    throw new Error(
      "preview only works for directory projects (the workbook is the build target)",
    );
  }

  // Tear down any existing preview for this project first
  const state = loadPreviewState();
  if (state.active[projectName]) {
    try {
      unlinkSync(state.active[projectName]);
    } catch {
      // ignore
    }
    delete state.active[projectName];
  }

  // Read the project
  const dir = target.path;
  const manifest = JSON.parse(
    await readFile(join(dir, "manifest.json"), "utf8"),
  ) as Manifest;
  const functions = JSON.parse(
    await readFile(join(dir, "functions.json"), "utf8"),
  ) as Record<string, FunctionDef>;

  console.log(`Building preview for ${manifest.name}@${manifest.version}...`);

  // Create the workbook in a stable per-project location so users can
  // open it from their file manager
  const previewDir = join(tmpdir(), "formulary-previews");
  mkdirSync(previewDir, { recursive: true });
  const xlsxPath = join(previewDir, `${manifest.name}.xlsx`);

  const adapter = await ExcelAdapter.create();

  // Install dependencies
  await installDepsIntoAdapter(adapter, manifest);

  // Install the project's own functions
  for (const [name, def] of Object.entries(functions)) {
    await adapter.createFunction({
      name,
      definition: def.definition,
      description: def.description,
    });
  }

  // Set metadata
  await adapter.writeMetadata({
    name: manifest.name,
    version: manifest.version,
    description: manifest.description ?? "",
    license: manifest.license ?? "MIT",
    owners: manifest.owners.join(","),
    dependencies: manifest.dependencies ?? {},
  });
  await adapter.writeLockfile({ packages: {} });

  await writeFile(xlsxPath, await adapter.save());

  // Record state
  state.active[projectName] = xlsxPath;
  savePreviewState(state);

  console.log(`✓ ${manifest.name}@${manifest.version}`);
  console.log(`  ${xlsxPath}`);
  console.log(`\nOpen the file to inspect, run \`formulary preview --teardown\` when done.`);
}

// ─── Teardown ─────────────────────────────────────────────────────

function doTeardown(projectName: string): void {
  const state = loadPreviewState();
  const path = state.active[projectName];
  if (!path) {
    console.log(`no active preview for "${projectName}"`);
    return;
  }
  try {
    unlinkSync(path);
    console.log(`✓ removed preview at ${path}`);
  } catch (e) {
    console.error(`failed to remove preview: ${(e as Error).message}`);
  }
  delete state.active[projectName];
  savePreviewState(state);
}

// ─── State persistence ────────────────────────────────────────────

function loadPreviewState(): PreviewState {
  if (!existsSync(PREVIEW_STATE_FILE)) {
    return { active: {} };
  }
  try {
    return JSON.parse(readFileSync(PREVIEW_STATE_FILE, "utf8"));
  } catch {
    return { active: {} };
  }
}

function savePreviewState(state: PreviewState): void {
  mkdirSync(join(homedir(), ".formulary"), { recursive: true });
  writeFileSync(PREVIEW_STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

// ─── Dep installation ─────────────────────────────────────────────

async function installDepsIntoAdapter(
  adapter: ExcelAdapter,
  manifest: Manifest,
): Promise<void> {
  const directDeps = manifest.dependencies ?? {};
  if (Object.keys(directDeps).length === 0) return;

  const registry = new RegistryClient(REGISTRY_BASE);
  const fetchMeta = (name: string) =>
    fetchJSON(registry.packageMetaUrl(name)).then((d) =>
      registry.parsePackageMeta(d),
    );

  const lock: Lockfile = { packages: {} };

  for (const [depName, spec] of Object.entries(directDeps)) {
    const meta = await fetchMeta(depName);
    const picked = pickVersion(meta, spec, "excel");
    if (!picked) {
      throw new Error(`cannot resolve ${depName}${spec ? ` (${spec})` : ""}`);
    }

    const transitive = await resolveDeps(
      depName,
      picked.version,
      fetchMeta,
      lock,
      "excel",
    );

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
}
