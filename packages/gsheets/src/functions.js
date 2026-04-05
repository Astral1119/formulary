/* global SpreadsheetApp, Utilities, Logger */

/**
 * Named function management.
 *
 * Google Sheets does not yet expose a programmatic API for named functions
 * (LAMBDA-based). This module stubs the interface so the rest of the add-on
 * can work end-to-end. When Google adds the API, only this file changes.
 */

/**
 * Parse a dependency string like "error>=0.2.0" into { name, specifier }.
 * @param {string} dep
 * @returns {{ name: string, specifier: string }}
 */
function parseDep_(dep) {
  var match = dep.match(/^([A-Za-z0-9_-]+)(.*)/);
  if (!match) return { name: dep, specifier: "" };
  return { name: match[1], specifier: match[2] || "" };
}

/**
 * Resolve the full dependency tree for a package.
 * Returns a flat map of { name: { version, versionData } } for all
 * transitive dependencies that aren't already in the lockfile.
 *
 * @param {string} name - Root package name
 * @param {string} version - Root package version
 * @param {Object} index - Full registry index
 * @param {Object} lock - Current lockfile
 * @returns {Array<{ name: string, version: string, versionData: Object }>}
 */
function resolveDeps_(name, version, index, lock) {
  var toInstall = [];
  var visited = {};

  // Seed with already-locked packages
  var lockedNames = Object.keys(lock.packages || {});
  for (var i = 0; i < lockedNames.length; i++) {
    visited[lockedNames[i]] = true;
  }

  function visit(pkgName, specifier) {
    if (visited[pkgName]) return;
    visited[pkgName] = true;

    var pkg = index[pkgName];
    if (!pkg) {
      Logger.log("Dependency not found in registry: " + pkgName);
      return;
    }

    // Find best matching version: latest that satisfies the specifier
    var versions = Object.keys(pkg.versions || {});
    var resolved = null;
    var resolvedData = null;

    // Sort descending so we pick the latest first
    versions.sort(function (a, b) {
      var va = Formulary.parseSemVer(a);
      var vb = Formulary.parseSemVer(b);
      if (!va || !vb) return 0;
      return Formulary.compareSemVer(vb, va);
    });

    for (var j = 0; j < versions.length; j++) {
      if (!specifier || Formulary.satisfies(versions[j], specifier)) {
        resolved = versions[j];
        resolvedData = pkg.versions[versions[j]];
        break;
      }
    }

    if (!resolved) {
      Logger.log("No version of " + pkgName + " satisfies " + specifier);
      return;
    }

    toInstall.push({ name: pkgName, version: resolved, versionData: resolvedData });

    // Recurse into this package's dependencies
    var deps = resolvedData.dependencies || [];
    for (var k = 0; k < deps.length; k++) {
      var parsed = parseDep_(deps[k]);
      visit(parsed.name, parsed.specifier);
    }
  }

  // Don't re-visit the root package
  visited[name] = true;

  // Start with the root package's dependencies
  var rootPkg = index[name];
  var rootVersion = (rootPkg && rootPkg.versions || {})[version];
  var rootDeps = (rootVersion && rootVersion.dependencies) || [];
  for (var d = 0; d < rootDeps.length; d++) {
    var p = parseDep_(rootDeps[d]);
    visit(p.name, p.specifier);
  }

  return toInstall;
}

/**
 * Install a package and all its transitive dependencies.
 *
 * @param {string} name - Package name
 * @param {string} version - Package version
 * @returns {Object} Result with status and installed packages
 */
function installPackage(name, version) {
  ensureInitialized_();

  var index = fetchRegistryIndex();
  var pkg = index[name];
  if (!pkg) {
    return { success: false, error: "Package not found: " + name };
  }

  var versionData = (pkg.versions || {})[version];
  if (!versionData) {
    return { success: false, error: "Version " + version + " not found" };
  }

  var lock = readLockfile() || { packages: {} };

  // Resolve transitive dependencies
  var transitiveDeps = resolveDeps_(name, version, index, lock);

  // Collect all packages to install (root + transitive)
  var allToInstall = [{ name: name, version: version, versionData: versionData }]
    .concat(transitiveDeps);

  var installedNames = [];

  for (var i = 0; i < allToInstall.length; i++) {
    var item = allToInstall[i];

    // Download and extract
    var blob = downloadPackage(item.name, item.version);
    var functions = extractFunctions_(blob);

    // Record in lockfile
    var deps = item.versionData.dependencies || [];
    var depNames = [];
    for (var j = 0; j < deps.length; j++) {
      depNames.push(parseDep_(deps[j]).name);
    }

    lock.packages[item.name] = {
      version: item.version,
      resolved: "registry:" + item.name + "/" + item.version,
      integrity: "",
      dependencies: depNames,
      functions: Object.keys(functions),
    };

    installedNames.push(item.name + "@" + item.version);
  }

  writeLockfile(lock);

  // Update project metadata — only add the root as a direct dependency
  var projectMeta = readMetadata() || { dependencies: {} };
  projectMeta.dependencies = projectMeta.dependencies || {};
  projectMeta.dependencies[name] = ">=" + version;
  writeMetadata(projectMeta);

  return {
    success: true,
    message: "Installed: " + installedNames.join(", "),
  };
}

/**
 * Remove a package from metadata and lockfile.
 * Also removes orphaned transitive dependencies.
 *
 * @param {string} name - Package name
 * @returns {Object} Result
 */
function removePackage(name) {
  var lock = readLockfile();
  if (!lock || !lock.packages || !lock.packages[name]) {
    return { success: false, error: "Package " + name + " is not installed" };
  }

  var removedFunctions = lock.packages[name].functions || [];
  delete lock.packages[name];

  // Remove orphaned transitive deps: anything not depended on by remaining packages
  // and not a direct dependency in the manifest
  var meta = readMetadata();
  var directDeps = (meta && meta.dependencies) ? Object.keys(meta.dependencies) : [];

  var needed = {};
  for (var i = 0; i < directDeps.length; i++) {
    if (directDeps[i] !== name) {
      needed[directDeps[i]] = true;
    }
  }

  // Walk from remaining direct deps to find all transitively needed packages
  var queue = Object.keys(needed);
  while (queue.length > 0) {
    var current = queue.shift();
    var entry = lock.packages[current];
    if (!entry) continue;
    var deps = entry.dependencies || [];
    for (var j = 0; j < deps.length; j++) {
      if (!needed[deps[j]]) {
        needed[deps[j]] = true;
        queue.push(deps[j]);
      }
    }
  }

  // Remove anything not needed
  var orphaned = [];
  var remaining = Object.keys(lock.packages);
  for (var k = 0; k < remaining.length; k++) {
    if (!needed[remaining[k]]) {
      orphaned.push(remaining[k]);
      removedFunctions = removedFunctions.concat(lock.packages[remaining[k]].functions || []);
      delete lock.packages[remaining[k]];
    }
  }

  writeLockfile(lock);

  if (meta && meta.dependencies) {
    delete meta.dependencies[name];
    writeMetadata(meta);
  }

  var msg = "Removed " + name;
  if (orphaned.length > 0) {
    msg += " (and orphaned: " + orphaned.join(", ") + ")";
  }

  return {
    success: true,
    message: msg,
    functions: removedFunctions,
  };
}

/**
 * Extract functions.json from a .gspkg/.fpkg ZIP blob.
 * @param {Blob} blob
 * @returns {Object} Function definitions
 */
function extractFunctions_(blob) {
  try {
    var unzipped = Utilities.unzip(blob);
    for (var i = 0; i < unzipped.length; i++) {
      if (unzipped[i].getName() === "functions.json") {
        return JSON.parse(unzipped[i].getDataAsString());
      }
    }
    return {};
  } catch (e) {
    Logger.log("Failed to extract functions: " + e.message);
    return {};
  }
}
