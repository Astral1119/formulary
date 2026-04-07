/**
 * Parse .fpkg zip bundles in the browser.
 * Mirrors cli/src/bundle.ts but runs in the Office Add-in context.
 */

import JSZip from "jszip";
import type { Manifest, FunctionDef, PackageBundle } from "@formulary/core";

export async function parseBundle(
  data: ArrayBuffer | Uint8Array,
): Promise<PackageBundle> {
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

  for (const platform of ["excel", "gsheets", "lattice"] as const) {
    const platformFile = zip.file(`functions.${platform}.json`);
    if (platformFile) {
      bundle.platformFunctions ??= {};
      bundle.platformFunctions[platform] = JSON.parse(
        await platformFile.async("text"),
      );
    }
  }

  const readme = zip.file("README.md");
  if (readme) {
    bundle.readme = await readme.async("text");
  }

  return bundle;
}
