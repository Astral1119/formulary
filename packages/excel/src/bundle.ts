/**
 * Parse and build .fpkg zip bundles in the browser.
 * Mirrors cli/src/bundle.ts but runs in the Office Add-in context.
 */

import JSZip from "jszip";
import type {
  Manifest,
  FunctionDef,
  PackageBundle,
  Platform,
} from "@formulary/core";

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

/** Options for building a .fpkg from in-memory data. */
export interface BuildBundleOptions {
  manifest: Manifest;
  functions: Record<string, FunctionDef>;
  platformFunctions?: Partial<Record<Platform, Record<string, FunctionDef>>>;
  readme?: string;
}

/**
 * Pack a manifest + functions into a .fpkg as raw bytes.
 *
 * Mirrors `cli/src/commands/pack.ts` but reads from in-memory objects
 * instead of disk. Used by the add-in's publish flow.
 */
export async function buildBundle(
  opts: BuildBundleOptions,
): Promise<Uint8Array> {
  const zip = new JSZip();

  zip.file("manifest.json", JSON.stringify(opts.manifest, null, 2));
  zip.file("functions.json", JSON.stringify(opts.functions, null, 2));

  if (opts.platformFunctions) {
    for (const [platform, funcs] of Object.entries(opts.platformFunctions)) {
      if (funcs) {
        zip.file(
          `functions.${platform}.json`,
          JSON.stringify(funcs, null, 2),
        );
      }
    }
  }

  if (opts.readme) {
    zip.file("README.md", opts.readme);
  }

  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
}
