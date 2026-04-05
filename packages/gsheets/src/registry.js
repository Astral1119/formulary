/* global UrlFetchApp, CacheService, Formulary */

var REGISTRY_URL =
  "https://raw.githubusercontent.com/Astral1119/formulary-registry/main";

var INDEX_CACHE_KEY = "formulary_index";
var INDEX_CACHE_TTL = 300; // 5 minutes

/**
 * Fetch the registry index, with CacheService caching.
 * @returns {Object} Parsed index.json
 */
function fetchRegistryIndex() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(INDEX_CACHE_KEY);
  if (cached) {
    return JSON.parse(cached);
  }

  var response = UrlFetchApp.fetch(REGISTRY_URL + "/index.json", {
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) {
    throw new Error("Failed to fetch registry index: " + response.getResponseCode());
  }

  var text = response.getContentText();

  // CacheService has a 100KB value limit. Only cache if it fits.
  if (text.length < 100000) {
    cache.put(INDEX_CACHE_KEY, text, INDEX_CACHE_TTL);
  }

  return JSON.parse(text);
}

/**
 * Fetch metadata for a specific package.
 * @param {string} name - Package name
 * @returns {Object} Parsed meta.json for the package
 */
function fetchPackageMeta(name) {
  var index = fetchRegistryIndex();
  var pkg = index[name];
  if (!pkg) {
    throw new Error("Package not found: " + name);
  }
  return { name: name, data: pkg };
}

/**
 * Download a package artifact.
 * @param {string} name - Package name
 * @param {string} version - Package version
 * @returns {Blob} The .gspkg/.fpkg file as a blob
 */
function downloadPackage(name, version) {
  var url =
    REGISTRY_URL +
    "/packages/" + name + "/" + version + "/" + name + "-" + version + ".gspkg";
  var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) {
    throw new Error(
      "Failed to download " + name + "@" + version + ": " + response.getResponseCode()
    );
  }
  return response.getBlob();
}

/**
 * Get a simplified list of all packages for the sidebar.
 * @returns {Array<Object>} Package summaries
 */
function getPackageList() {
  var index = fetchRegistryIndex();
  var packages = [];
  var names = Object.keys(index);
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var pkg = index[name];
    packages.push({
      name: name,
      description: pkg.description || "",
      latest: pkg.latest || Object.keys(pkg.versions || {}).pop() || "?",
      owners: pkg.owners || [],
    });
  }
  packages.sort(function (a, b) {
    return a.name.localeCompare(b.name);
  });
  return packages;
}

/**
 * Get detailed info for a specific package.
 * @param {string} name - Package name
 * @returns {Object} Package details with all versions
 */
function getPackageDetails(name) {
  var index = fetchRegistryIndex();
  var pkg = index[name];
  if (!pkg) return null;

  var versions = pkg.versions || {};
  var versionList = Object.keys(versions).sort(function (a, b) {
    var va = Formulary.parseSemVer(a);
    var vb = Formulary.parseSemVer(b);
    if (!va || !vb) return 0;
    return Formulary.compareSemVer(vb, va);
  });

  return {
    name: name,
    description: pkg.description || "",
    latest: pkg.latest || versionList[0] || "?",
    owners: pkg.owners || [],
    versions: versionList,
    versionDetails: versions,
  };
}
