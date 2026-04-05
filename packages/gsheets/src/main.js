/* global SpreadsheetApp, HtmlService, Session */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Formulary")
    .addItem("Open sidebar", "showSidebar")
    .addToUi();
}

function showSidebar() {
  var html = HtmlService.createHtmlOutputFromFile("Sidebar")
    .setTitle("Formulary")
    .setWidth(320);
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * Check if the project has been initialized (has a manifest sheet).
 * @returns {boolean}
 */
function isInitialized() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(MANIFEST_SHEET) !== null;
}

/**
 * Ensure hidden sheets exist. Called lazily on first install
 * or explicitly by the user via the Project tab.
 * @param {Object} [opts] - { name, description }
 * @returns {Object} Result with metadata
 */
function ensureInitialized_(opts) {
  if (isInitialized()) {
    return { created: false, metadata: readMetadata() };
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = (opts && opts.name) ||
    ss.getName()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") ||
    "my-project";

  var owner = "";
  try { owner = Session.getActiveUser().getEmail(); } catch (e) { /* no permission */ }

  var meta = {
    name: name,
    version: (opts && opts.version) || "0.1.0",
    description: (opts && opts.description) || "",
    license: (opts && opts.license) || "MIT",
    owners: owner,
    exports: "",
    dependencies: {},
  };

  writeMetadata(meta);
  getLockSheet_();

  return { created: true, metadata: meta };
}

/**
 * Explicit init for authors who want to set up metadata.
 * @param {Object} opts - { name, description }
 * @returns {Object} Result
 */
function initProject(opts) {
  var result = ensureInitialized_(opts);
  return { success: true, metadata: result.metadata, created: result.created };
}

/**
 * Update a single manifest field.
 * @param {string} key
 * @param {string} value
 * @returns {Object} Result
 */
function updateManifestField(key, value) {
  var meta = readMetadata();
  if (!meta) {
    return { success: false, error: "Project not initialized" };
  }

  if (key.indexOf("dep:") === 0) {
    var depName = key.slice(4);
    if (value) {
      meta.dependencies[depName] = value;
    } else {
      delete meta.dependencies[depName];
    }
  } else {
    meta[key] = value;
  }

  writeMetadata(meta);
  return { success: true, metadata: meta };
}
