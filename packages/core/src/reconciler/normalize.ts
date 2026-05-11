import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import type { Lockfile, NamedFunction, ProjectMetadata } from "../adapter.js";
import {
  RECONCILER_SCHEMA_VERSION,
  type FunctionOrigin,
  type LockfileState,
  type ProjectState,
  type WorkbookFunction,
  type WorkbookTarget,
} from "./types.js";

export function normalizeFunction(
  fn: NamedFunction,
  origin: FunctionOrigin = { kind: "unknown" },
): WorkbookFunction {
  return {
    name: fn.name,
    definition: fn.definition,
    description: fn.description,
    parameters: fn.parameters.map((parameter) => ({
      ...parameter,
      examples: [...parameter.examples],
    })),
    examples: [],
    origin: { ...origin },
    hash: hashFunction(fn),
  };
}

export function normalizeProjectMetadata(
  meta: ProjectMetadata | null,
  targetIds: WorkbookTarget["id"][],
): ProjectState {
  return {
    schemaVersion: RECONCILER_SCHEMA_VERSION,
    initialized: meta !== null,
    name: meta?.name,
    version: meta?.version,
    description: meta?.description,
    license: meta?.license,
    owners: splitList(meta?.owners),
    directDependencies: { ...(meta?.dependencies ?? {}) },
    exports: splitList(meta?.exports),
    targetIds: [...targetIds],
  };
}

export function normalizeLockfile(
  lockfile: Lockfile | null,
  directDependencies: Record<string, string>,
): LockfileState {
  const packages: LockfileState["packages"] = {};

  for (const [name, entry] of Object.entries(lockfile?.packages ?? {})) {
    packages[name] = {
      name,
      version: entry.version,
      resolved: entry.resolved,
      integrity: entry.integrity,
      dependencies: [...entry.dependencies],
      functions: [...entry.functions],
      direct: Object.hasOwn(directDependencies, name),
    };
  }

  return {
    schemaVersion: RECONCILER_SCHEMA_VERSION,
    packages,
  };
}

function splitList(value: string | undefined): string[] {
  return value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function hashFunction(fn: NamedFunction): string {
  const digest = bytesToHex(
    sha256(
      utf8ToBytes(
        JSON.stringify({
          name: fn.name,
          definition: fn.definition,
          description: fn.description,
          parameters: fn.parameters.map((parameter) => ({
            name: parameter.name,
            description: parameter.description,
            examples: [...parameter.examples].sort(),
          })),
        }),
      ),
    ),
  );

  return `sha256:${digest}`;
}
