import {
  RegistryClient,
  resolveFunctions,
  resolveDeps,
  pickVersion,
} from "@formulary/core";
import type { PackageMeta, VersionMeta, Lockfile } from "@formulary/core";
import { OfficeJSAdapter } from "../adapter/officejs-adapter.js";
import { parseBundle } from "../bundle.js";

// ─── State ────────────────────────────────────────────────────────

const REGISTRY_BASE =
  "https://raw.githubusercontent.com/Astral1119/formulary-registry/main";

const registry = new RegistryClient(REGISTRY_BASE);
const adapter = new OfficeJSAdapter();

let allPackages: PackageMeta[] = [];
let installedMap: Record<string, string> = {}; // name -> version

// ─── Init ─────────────────────────────────────────────────────────

Office.onReady(async () => {
  bindEvents();
  await Promise.all([loadBrowse(), refreshInstalled()]);
});

function bindEvents(): void {
  // Tab switching
  for (const tab of document.querySelectorAll<HTMLElement>(".tab")) {
    tab.addEventListener("click", () => switchTab(tab.dataset.panel!));
  }

  // Search
  document.getElementById("search")!.addEventListener("input", filterPackages);

  // Back button
  document.getElementById("btn-back")!.addEventListener("click", hideDetail);

  // Init button
  document.getElementById("btn-init")!.addEventListener("click", doInit);

  // Local file install
  const fileInput = document.getElementById("file-input") as HTMLInputElement;
  fileInput.addEventListener("change", () => {
    if (fileInput.files?.[0]) {
      installFromFile(fileInput.files[0]);
      fileInput.value = "";
    }
  });

  // Drag and drop
  const fileDrop = document.getElementById("file-drop")!;
  fileDrop.addEventListener("dragover", (e) => {
    e.preventDefault();
    fileDrop.classList.add("dragover");
  });
  fileDrop.addEventListener("dragleave", () => {
    fileDrop.classList.remove("dragover");
  });
  fileDrop.addEventListener("drop", (e) => {
    e.preventDefault();
    fileDrop.classList.remove("dragover");
    const file = (e as DragEvent).dataTransfer?.files[0];
    if (file) installFromFile(file);
  });
}

// ─── Tabs ─────────────────────────────────────────────────────────

function switchTab(name: string): void {
  for (const t of document.querySelectorAll<HTMLElement>(".tab")) {
    const isActive = t.dataset.panel === name;
    t.classList.toggle("active", isActive);
    t.setAttribute("aria-selected", String(isActive));
  }
  for (const p of document.querySelectorAll<HTMLElement>(".panel")) {
    p.classList.toggle("active", p.id === `${name}-panel`);
  }
  hideDetail();
  if (name === "installed") loadInstalled();
  if (name === "project") loadProject();
}

// ─── Browse ───────────────────────────────────────────────────────

async function loadBrowse(): Promise<void> {
  try {
    const index = await adapter.fetchJSON(registry.indexUrl());
    const parsed = registry.parseIndex(index);
    allPackages = [];

    for (const [name, entry] of Object.entries(parsed.packages ?? {})) {
      // Fetch full meta for each (or build minimal from index)
      allPackages.push({
        name,
        owners: [],
        versions: {},
        ...entry,
      } as unknown as PackageMeta);
    }

    renderPackages(allPackages);
  } catch (err) {
    showStatus(`Failed to load: ${(err as Error).message}`, "error");
    document.getElementById("package-list")!.innerHTML =
      '<li class="empty-state">Failed to load packages</li>';
  }
}

function renderPackages(pkgs: PackageMeta[]): void {
  const list = document.getElementById("package-list")!;
  if (!pkgs.length) {
    list.innerHTML = '<li class="empty-state">No packages found</li>';
    return;
  }

  list.innerHTML = pkgs
    .map((p) => {
      const badge = installedMap[p.name]
        ? '<span class="pkg-badge">installed</span>'
        : "";
      const latest =
        (p as any).latest ??
        Object.keys(p.versions).sort().pop() ??
        "";
      const desc = (p as any).description ?? "";
      return `
        <li class="package-item" data-pkg="${esc(p.name)}">
          <div class="pkg-row">
            <span class="pkg-name">${esc(p.name)}</span>
            <span class="pkg-version">${esc(latest)}</span>
            ${badge}
          </div>
          ${desc ? `<div class="pkg-desc">${esc(desc)}</div>` : ""}
        </li>`;
    })
    .join("");

  // Bind click handlers
  for (const item of list.querySelectorAll<HTMLElement>(".package-item")) {
    item.addEventListener("click", () => showDetail(item.dataset.pkg!));
  }
}

function filterPackages(): void {
  const q = (document.getElementById("search") as HTMLInputElement).value.toLowerCase();
  const filtered = allPackages.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      ((p as any).description ?? "").toLowerCase().includes(q),
  );
  renderPackages(filtered);
}

// ─── Detail ───────────────────────────────────────────────────────

async function showDetail(name: string): Promise<void> {
  showStatus("Loading...", "info");

  try {
    const meta: PackageMeta = await adapter
      .fetchJSON(registry.packageMetaUrl(name))
      .then((d) => registry.parsePackageMeta(d));

    clearStatus();
    renderDetail(meta);
  } catch {
    // Fallback: use index data
    const fromIndex = allPackages.find((p) => p.name === name);
    if (fromIndex) {
      clearStatus();
      renderDetail(fromIndex);
    } else {
      showStatus("Package not found", "error");
    }
  }
}

function renderDetail(pkg: PackageMeta): void {
  document.getElementById("detail-name")!.textContent = pkg.name;

  const latest =
    (pkg as any).latest ?? Object.keys(pkg.versions).sort().pop() ?? "?";
  document.getElementById("detail-version")!.textContent = `v${latest}`;
  document.getElementById("detail-desc")!.textContent =
    (pkg as any).description ?? "No description";

  // Actions
  const actions = document.getElementById("detail-actions")!;
  const isInstalled = !!installedMap[pkg.name];
  if (isInstalled) {
    actions.innerHTML = `
      <button class="btn btn-danger" id="btn-remove">Remove</button>
      <span style="color:var(--fg-faint);font-size:12px">v${esc(installedMap[pkg.name])} installed</span>`;
    document
      .getElementById("btn-remove")!
      .addEventListener("click", () => doRemove(pkg.name));
  } else {
    actions.innerHTML = `
      <button class="btn btn-primary" id="btn-install">Install v${esc(latest)}</button>`;
    document
      .getElementById("btn-install")!
      .addEventListener("click", () => doInstall(pkg.name, latest));
  }

  // Dependencies
  const latestMeta = pkg.versions[latest];
  const deps = latestMeta?.dependencies ?? {};
  const depsEl = document.getElementById("detail-deps")!;
  const depEntries = Object.entries(deps);
  depsEl.innerHTML = depEntries.length
    ? depEntries
        .map(([d, spec]) => `<li class="dep-item">${esc(d)} ${esc(spec)}</li>`)
        .join("")
    : "<li class=\"dep-item\">None</li>";

  // Exports
  const exps = latestMeta?.exports ?? [];
  const funcsEl = document.getElementById("detail-funcs")!;
  funcsEl.innerHTML = exps.length
    ? exps.map((f) => `<li class="func-item">${esc(f)}</li>`).join("")
    : "<li class=\"func-item\">None listed</li>";

  // Owners
  document.getElementById("detail-owners")!.textContent = (
    pkg.owners ?? []
  ).join(", ");

  // Show detail view
  document.getElementById("detail-view")!.hidden = false;
  for (const p of document.querySelectorAll<HTMLElement>(".panel")) {
    p.classList.remove("active");
  }
}

function hideDetail(): void {
  document.getElementById("detail-view")!.hidden = true;
  const activeTab = document.querySelector<HTMLElement>(".tab.active");
  if (activeTab) {
    const panel = document.getElementById(`${activeTab.dataset.panel}-panel`);
    if (panel) panel.classList.add("active");
  }
}

// ─── Install / Remove ─────────────────────────────────────────────

async function doInstall(name: string, version: string): Promise<void> {
  showStatus(`Installing ${name}@${version}...`, "info");

  try {
    const lock = (await adapter.readLockfile()) ?? { packages: {} };
    const meta = (await adapter.readMetadata()) ?? {
      dependencies: {} as Record<string, string>,
    };

    // Fetch package meta
    const pkgMeta = registry.parsePackageMeta(
      await adapter.fetchJSON(registry.packageMetaUrl(name)),
    );

    const picked = pickVersion(pkgMeta, version);
    if (!picked) throw new Error(`Version ${version} not found`);

    // Resolve transitive deps
    const deps = await resolveDeps(
      name,
      picked.version,
      async (depName: string) =>
        registry.parsePackageMeta(
          await adapter.fetchJSON(registry.packageMetaUrl(depName)),
        ),
      lock,
    );

    // Install deps first, then root
    const toInstall = [
      ...deps.map((d) => ({
        name: d.name,
        version: d.version,
        versionMeta: d.meta,
      })),
      { name, version: picked.version, versionMeta: picked.meta },
    ];

    // Get existing named functions for upgrade detection
    const existing = await adapter.listFunctions();
    const existingNames = new Set(existing.map((f) => f.name.toUpperCase()));

    let totalAdded = 0;
    let totalUpdated = 0;

    for (const pkg of toInstall) {
      showStatus(
        `Downloading ${pkg.name}@${pkg.version}...`,
        "info",
      );

      const artifactUrl = registry.artifactUrl(pkg.versionMeta.artifact);
      const data = await adapter.fetchBinary(artifactUrl);

      // Parse .fpkg bundle and resolve platform-specific functions
      const bundle = await parseBundle(data);
      const functions = resolveFunctions(bundle, "excel");
      const functionNames = Object.keys(functions);

      // Install each named function into the workbook
      for (const [fnName, def] of Object.entries(functions)) {
        const fn = {
          name: fnName,
          definition: def.definition,
          description: def.description,
        };

        if (existingNames.has(fnName.toUpperCase())) {
          await adapter.updateFunction(fn);
          totalUpdated++;
        } else {
          await adapter.createFunction(fn);
          totalAdded++;
        }
        // Track so subsequent packages in this batch see them
        existingNames.add(fnName.toUpperCase());
      }

      // Update lockfile entry
      lock.packages[pkg.name] = {
        version: pkg.version,
        resolved: `registry:${pkg.name}/${pkg.version}`,
        integrity: pkg.versionMeta.integrity,
        dependencies: Object.keys(pkg.versionMeta.dependencies ?? {}),
        functions: functionNames,
      };
    }

    // Record direct dependency
    meta.dependencies[name] = `>=${picked.version}`;

    await adapter.writeMetadata(meta);
    await adapter.writeLockfile(lock);

    installedMap[name] = picked.version;
    const parts: string[] = [];
    if (totalAdded > 0) parts.push(`${totalAdded} added`);
    if (totalUpdated > 0) parts.push(`${totalUpdated} updated`);
    const counts = parts.length ? ` (${parts.join(", ")})` : "";
    showStatus(`Installed ${name}@${picked.version}${counts}`, "success");
    hideDetail();
    renderPackages(allPackages);
  } catch (err) {
    showStatus(`Install failed: ${(err as Error).message}`, "error");
  }
}

async function installFromFile(file: File): Promise<void> {
  showStatus(`Installing from ${file.name}...`, "info");

  try {
    const data = await file.arrayBuffer();
    const bundle = await parseBundle(data);
    const manifest = bundle.manifest;
    const functions = resolveFunctions(bundle, "excel");
    const functionNames = Object.keys(functions);

    if (functionNames.length === 0) {
      throw new Error(`Package "${manifest.name}" has no functions`);
    }

    // Ensure metadata sheets exist
    const lock = (await adapter.readLockfile()) ?? { packages: {} };
    const meta = (await adapter.readMetadata()) ?? {
      dependencies: {} as Record<string, string>,
    };

    // Detect existing for update vs create
    const existing = await adapter.listFunctions();
    const existingNames = new Set(existing.map((f) => f.name.toUpperCase()));

    let added = 0;
    let updated = 0;

    for (const [fnName, def] of Object.entries(functions)) {
      const fn = {
        name: fnName,
        definition: def.definition,
        description: def.description,
      };

      if (existingNames.has(fnName.toUpperCase())) {
        await adapter.updateFunction(fn);
        updated++;
      } else {
        await adapter.createFunction(fn);
        added++;
      }
    }

    // Update lockfile + metadata
    lock.packages[manifest.name] = {
      version: manifest.version,
      resolved: `local:${file.name}`,
      dependencies: Object.keys(manifest.dependencies ?? {}),
      functions: functionNames,
    };
    meta.dependencies[manifest.name] = manifest.version;

    await adapter.writeLockfile(lock);
    await adapter.writeMetadata(meta);

    installedMap[manifest.name] = manifest.version;

    const parts: string[] = [];
    if (added > 0) parts.push(`${added} added`);
    if (updated > 0) parts.push(`${updated} updated`);
    showStatus(
      `Installed ${manifest.name}@${manifest.version} (${parts.join(", ")}, ${functionNames.length} functions)`,
      "success",
    );
    loadInstalled();
  } catch (err) {
    showStatus(`Install failed: ${(err as Error).message}`, "error");
  }
}

async function doRemove(name: string): Promise<void> {
  showStatus(`Removing ${name}...`, "info");

  try {
    const lock = await adapter.readLockfile();
    if (!lock?.packages[name]) throw new Error(`${name} is not installed`);

    const meta = (await adapter.readMetadata()) ?? {
      dependencies: {} as Record<string, string>,
    };

    // Collect functions to delete
    const removedFunctions = [...(lock.packages[name].functions ?? [])];
    delete lock.packages[name];

    // Find orphaned transitive deps
    const directDeps = new Set(
      Object.keys(meta.dependencies).filter((d) => d !== name),
    );
    const needed = new Set<string>(directDeps);
    const queue = [...needed];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const entry = lock.packages[current];
      if (!entry) continue;
      for (const dep of entry.dependencies) {
        if (!needed.has(dep)) {
          needed.add(dep);
          queue.push(dep);
        }
      }
    }

    const orphaned: string[] = [];
    for (const n of Object.keys(lock.packages)) {
      if (!needed.has(n)) {
        orphaned.push(n);
        removedFunctions.push(...(lock.packages[n].functions ?? []));
        delete lock.packages[n];
      }
    }

    // Delete named functions
    for (const fn of removedFunctions) {
      try {
        await adapter.deleteFunction(fn);
      } catch {
        // May not exist
      }
    }

    delete meta.dependencies[name];
    await adapter.writeMetadata(meta);
    await adapter.writeLockfile(lock);

    delete installedMap[name];
    const msg =
      orphaned.length > 0
        ? `Removed ${name} (and ${orphaned.join(", ")})`
        : `Removed ${name}`;
    showStatus(msg, "success");
    hideDetail();
    renderPackages(allPackages);
  } catch (err) {
    showStatus(`Remove failed: ${(err as Error).message}`, "error");
  }
}

// ─── Installed tab ────────────────────────────────────────────────

async function loadInstalled(): Promise<void> {
  const list = document.getElementById("installed-list")!;
  list.innerHTML =
    '<li class="loading-state"><div class="loader"></div><span>Loading...</span></li>';

  try {
    const lock = await adapter.readLockfile();
    if (!lock || Object.keys(lock.packages).length === 0) {
      list.innerHTML = '<li class="empty-state">No packages installed</li>';
      return;
    }

    const meta = await adapter.readMetadata();
    const directDeps = new Set(Object.keys(meta?.dependencies ?? {}));

    installedMap = {};
    const names = Object.keys(lock.packages).sort();

    list.innerHTML = names
      .map((name) => {
        const entry = lock.packages[name];
        installedMap[name] = entry.version;
        const direct = directDeps.has(name) ? "" : " (transitive)";
        const fns = (entry.functions ?? []).join(", ");
        return `
          <li class="package-item" data-pkg="${esc(name)}">
            <div class="pkg-row">
              <span class="pkg-name">${esc(name)}</span>
              <span class="pkg-version">${esc(entry.version)}${direct}</span>
            </div>
            ${fns ? `<div class="pkg-functions">${esc(fns)}</div>` : ""}
          </li>`;
      })
      .join("");

    for (const item of list.querySelectorAll<HTMLElement>(".package-item")) {
      item.addEventListener("click", () => showDetail(item.dataset.pkg!));
    }
  } catch (err) {
    list.innerHTML = `<li class="empty-state">Error: ${esc((err as Error).message)}</li>`;
  }
}

async function refreshInstalled(): Promise<void> {
  try {
    const lock = await adapter.readLockfile();
    if (lock) {
      installedMap = {};
      for (const [name, entry] of Object.entries(lock.packages)) {
        installedMap[name] = entry.version;
      }
    }
  } catch {
    // Not initialized yet, that's fine
  }
}

// ─── Project tab ──────────────────────────────────────────────────

const MANIFEST_FIELDS = [
  { key: "name", label: "Name", placeholder: "my-package" },
  { key: "version", label: "Version", placeholder: "0.1.0" },
  { key: "description", label: "Description", placeholder: "" },
  { key: "license", label: "License", placeholder: "MIT" },
  { key: "owners", label: "Owners", placeholder: "username" },
  { key: "exports", label: "Exports", placeholder: "FUNC_A, FUNC_B" },
];

async function loadProject(): Promise<void> {
  try {
    const meta = await adapter.readMetadata();
    if (!meta) {
      document.getElementById("project-not-init")!.hidden = false;
      document.getElementById("project-initialized")!.hidden = true;
      return;
    }

    document.getElementById("project-not-init")!.hidden = true;
    document.getElementById("project-initialized")!.hidden = false;
    renderProject(meta);
  } catch {
    document.getElementById("project-not-init")!.hidden = false;
    document.getElementById("project-initialized")!.hidden = true;
  }
}

function renderProject(meta: Record<string, unknown>): void {
  const fieldsEl = document.getElementById("project-fields")!;
  fieldsEl.innerHTML = MANIFEST_FIELDS.map((f) => {
    const val = String(meta[f.key] ?? "");
    return `
      <div class="field-row">
        <div class="field-label">${esc(f.label)}</div>
        <div class="field-value">
          <input type="text"
            data-key="${f.key}"
            value="${esc(val)}"
            placeholder="${esc(f.placeholder)}" />
        </div>
      </div>`;
  }).join("");

  // Bind blur handlers for inline editing
  for (const input of fieldsEl.querySelectorAll<HTMLInputElement>("input")) {
    input.addEventListener("blur", () => saveField(input));
  }

  const depsEl = document.getElementById("project-deps")!;
  const deps = (meta.dependencies ?? {}) as Record<string, string>;
  const depNames = Object.keys(deps);
  if (depNames.length === 0) {
    depsEl.innerHTML = '<div class="empty-state" style="padding:12px">No dependencies</div>';
  } else {
    depsEl.innerHTML = depNames
      .map(
        (name) => `
        <div class="field-row">
          <div class="field-label" style="font-family:var(--font-mono);font-size:12px">${esc(name)}</div>
          <div class="field-value">
            <input type="text" data-key="dep:${esc(name)}" value="${esc(deps[name])}" placeholder=">=0.0.0" />
          </div>
        </div>`,
      )
      .join("");

    for (const input of depsEl.querySelectorAll<HTMLInputElement>("input")) {
      input.addEventListener("blur", () => saveField(input));
    }
  }
}

async function saveField(input: HTMLInputElement): Promise<void> {
  const key = input.dataset.key!;
  const value = input.value.trim();

  input.classList.add("saving");
  try {
    const meta = (await adapter.readMetadata()) ?? {
      dependencies: {} as Record<string, string>,
    };

    if (key.startsWith("dep:")) {
      meta.dependencies[key.slice(4)] = value;
    } else {
      (meta as Record<string, unknown>)[key] = value;
    }

    await adapter.writeMetadata(meta);
  } finally {
    input.classList.remove("saving");
  }
}

async function doInit(): Promise<void> {
  const name = (document.getElementById("init-name") as HTMLInputElement).value.trim();
  const desc = (document.getElementById("init-desc") as HTMLInputElement).value.trim();

  try {
    await adapter.writeMetadata({
      name: name || "my-package",
      version: "0.1.0",
      description: desc,
      dependencies: {} as Record<string, string>,
    });
    await adapter.writeLockfile({ packages: {} });

    showStatus("Project initialized", "success");
    loadProject();
  } catch (err) {
    showStatus(`Init failed: ${(err as Error).message}`, "error");
  }
}

// ─── Util ─────────────────────────────────────────────────────────

function esc(s: string): string {
  if (!s) return "";
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function showStatus(msg: string, type: "info" | "error" | "success"): void {
  const el = document.getElementById("status")!;
  el.textContent = msg;
  el.className = `status visible ${type}`;
}

function clearStatus(): void {
  const el = document.getElementById("status")!;
  el.className = "status";
}
