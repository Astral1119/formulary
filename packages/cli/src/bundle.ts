/**
 * Parse .fpkg zip bundles into PackageBundle objects.
 *
 * Uses JSZip, so this lives in cli (not core) to keep core zero-dep.
 */

import JSZip from "jszip";
import type { Manifest, FunctionDef, PackageBundle } from "@formulary/core";

/**
 * Extract a PackageBundle from a zip archive (Uint8Array or ArrayBuffer).
 *
 * Expected zip contents:
 *   manifest.json              — package manifest
 *   functions.json             — universal function definitions
 *   functions.{platform}.json  — optional platform-specific overrides
 *   tests/*.yaml               — optional assay test suites
 *   README.md                  — optional
 */
export async function parseBundle(data: Uint8Array | ArrayBuffer): Promise<PackageBundle> {
  const zip = await JSZip.loadAsync(data);

  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) {
    throw new Error("Bundle is missing manifest.json");
  }
  const manifest: Manifest = JSON.parse(await manifestFile.async("text"));

  const functionsFile = zip.file("functions.json");
  if (!functionsFile) {
    throw new Error("Bundle is missing functions.json");
  }
  const functions: Record<string, FunctionDef> = JSON.parse(
    await functionsFile.async("text"),
  );

  const bundle: PackageBundle = { manifest, functions };

  // Platform-specific overrides: functions.excel.json, functions.gsheets.json, etc.
  for (const platform of ["excel", "gsheets", "lattice"] as const) {
    const platformFile = zip.file(`functions.${platform}.json`);
    if (platformFile) {
      bundle.platformFunctions ??= {};
      bundle.platformFunctions[platform] = JSON.parse(
        await platformFile.async("text"),
      );
    }
  }

  // Optional readme
  const readme = zip.file("README.md");
  if (readme) {
    bundle.readme = await readme.async("text");
  }

  return bundle;
}
