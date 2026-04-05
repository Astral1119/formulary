/* global SpreadsheetApp */

var MANIFEST_SHEET = "__manifest__";
var LOCK_SHEET = "__lock__";

// ── Manifest sheet ──────────────────────────────────
// Key-value table: column A = key, column B = value.
// Dependencies use "dep:<name>" as the key.

/**
 * Get or create the hidden manifest sheet.
 * @returns {Sheet}
 */
function getManifestSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MANIFEST_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(MANIFEST_SHEET);
    sheet.hideSheet();
    // Header row
    sheet.getRange("A1:B1").setValues([["key", "value"]]);
  }
  return sheet;
}

/**
 * Read manifest as a plain object from the key-value table.
 * Keys starting with "dep:" are grouped into a dependencies object.
 * @returns {Object}
 */
function readMetadata() {
  var sheet = getManifestSheet_();
  var data = sheet.getDataRange().getValues();
  var meta = { dependencies: {} };

  for (var i = 1; i < data.length; i++) {
    var key = String(data[i][0]).trim();
    var val = String(data[i][1]).trim();
    if (!key) continue;

    if (key.indexOf("dep:") === 0) {
      var depName = key.slice(4);
      meta.dependencies[depName] = val;
    } else {
      meta[key] = val;
    }
  }
  return meta;
}

/**
 * Write manifest object to the key-value table.
 * Clears existing data and rewrites all rows.
 * @param {Object} meta - Must have string values; dependencies is a sub-object.
 */
function writeMetadata(meta) {
  var sheet = getManifestSheet_();
  var rows = [["key", "value"]];

  var keys = Object.keys(meta);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (key === "dependencies") continue; // handled below
    rows.push([key, String(meta[key])]);
  }

  var deps = meta.dependencies || {};
  var depNames = Object.keys(deps);
  for (var j = 0; j < depNames.length; j++) {
    rows.push(["dep:" + depNames[j], String(deps[depNames[j]])]);
  }

  sheet.clearContents();
  if (rows.length > 0) {
    sheet.getRange(1, 1, rows.length, 2).setValues(rows);
  }
}

// ── Lock sheet ──────────────────────────────────────
// Flat table: package | version | integrity | dependencies | functions

var LOCK_HEADERS = ["package", "version", "integrity", "dependencies", "functions"];

/**
 * Get or create the hidden lock sheet.
 * @returns {Sheet}
 */
function getLockSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(LOCK_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(LOCK_SHEET);
    sheet.hideSheet();
    sheet.getRange(1, 1, 1, LOCK_HEADERS.length).setValues([LOCK_HEADERS]);
  }
  return sheet;
}

/**
 * Read lockfile as a structured object.
 * @returns {Object} { packages: { name: { version, integrity, dependencies, functions } } }
 */
function readLockfile() {
  var sheet = getLockSheet_();
  var data = sheet.getDataRange().getValues();
  var lock = { packages: {} };

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var name = String(row[0]).trim();
    if (!name) continue;

    lock.packages[name] = {
      version: String(row[1]).trim(),
      integrity: String(row[2]).trim(),
      dependencies: String(row[3]).trim()
        ? String(row[3]).trim().split(",").map(function (s) { return s.trim(); })
        : [],
      functions: String(row[4]).trim()
        ? String(row[4]).trim().split(",").map(function (s) { return s.trim(); })
        : [],
    };
  }
  return lock;
}

/**
 * Write lockfile to the lock sheet.
 * @param {Object} lock - { packages: { name: { version, integrity, dependencies, functions } } }
 */
function writeLockfile(lock) {
  var sheet = getLockSheet_();
  var rows = [LOCK_HEADERS];

  var names = Object.keys(lock.packages || {}).sort();
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var entry = lock.packages[name];
    rows.push([
      name,
      entry.version || "",
      entry.integrity || "",
      (entry.dependencies || []).join(", "),
      (entry.functions || []).join(", "),
    ]);
  }

  sheet.clearContents();
  if (rows.length > 0) {
    sheet.getRange(1, 1, rows.length, LOCK_HEADERS.length).setValues(rows);
  }
}

/**
 * Get installed packages from the lockfile.
 * Called from client-side JS via google.script.run.
 * @returns {Array<Object>} Installed package summaries
 */
function getInstalledPackages() {
  var lock = readLockfile();
  if (!lock || !lock.packages) return [];

  var packages = [];
  var names = Object.keys(lock.packages);
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var entry = lock.packages[name];
    packages.push({
      name: name,
      version: entry.version,
      functions: entry.functions || [],
    });
  }
  return packages;
}
