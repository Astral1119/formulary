import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import JSZip from "jszip";
import type { Manifest } from "@formulary/core";
import { validateManifest } from "@formulary/core";

/**
 * Pack a directory into an .fpkg zip bundle.
 *
 * Expected directory layout:
 *   manifest.json              — required
 *   functions.json             — required
 *   functions.{platform}.json  — optional platform overrides
 *   tests/*.yaml               — optional test suites
 *   README.md                  — optional
 */
export async function pack(
  dir: string,
  outputPath?: string,
): Promise<void> {
  dir = resolve(dir);

  // Read and validate manifest
  const manifestData = await readFile(join(dir, "manifest.json"), "utf-8").catch(
    () => {
      throw new Error(`No manifest.json found in ${dir}`);
    },
  );
  const manifest: Manifest = JSON.parse(manifestData);

  const errors = validateManifest(manifest);
  if (errors.length > 0) {
    throw new Error(`Invalid manifest:\n  ${errors.join("\n  ")}`);
  }

  // Read functions.json
  const functionsData = await readFile(join(dir, "functions.json"), "utf-8").catch(
    () => {
      throw new Error(`No functions.json found in ${dir}`);
    },
  );
  // Validate it's parseable
  JSON.parse(functionsData);

  const zip = new JSZip();
  zip.file("manifest.json", manifestData);
  zip.file("functions.json", functionsData);

  // Platform-specific overrides
  for (const platform of ["excel", "gsheets", "lattice"]) {
    const path = join(dir, `functions.${platform}.json`);
    try {
      const data = await readFile(path, "utf-8");
      JSON.parse(data); // validate
      zip.file(`functions.${platform}.json`, data);
      console.log(`  + functions.${platform}.json`);
    } catch {
      // Not present, skip
    }
  }

  // Tests
  const testsDir = join(dir, "tests");
  try {
    const testsStat = await stat(testsDir);
    if (testsStat.isDirectory()) {
      const testFiles = await readdir(testsDir);
      for (const file of testFiles) {
        if (file.endsWith(".yaml") || file.endsWith(".yml")) {
          const data = await readFile(join(testsDir, file), "utf-8");
          zip.file(`tests/${file}`, data);
          console.log(`  + tests/${file}`);
        }
      }
    }
  } catch {
    // No tests dir, skip
  }

  // README
  try {
    const readme = await readFile(join(dir, "README.md"), "utf-8");
    zip.file("README.md", readme);
    console.log("  + README.md");
  } catch {
    // No readme, skip
  }

  const output =
    outputPath ?? `${manifest.name}-${manifest.version}.fpkg`;
  const buffer = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });

  const { writeFile } = await import("node:fs/promises");
  await writeFile(output, buffer);

  const sizeKB = (buffer.length / 1024).toFixed(1);
  console.log(
    `✓ ${manifest.name}@${manifest.version} → ${output} (${sizeKB} KB)`,
  );
}
