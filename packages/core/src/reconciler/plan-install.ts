import type { Lockfile, NamedFunction } from "../adapter.js";
import { ResolveError, resolveDeps, pickVersion } from "../resolver.js";
import { resolveFunctions } from "../manifest.js";
import {
  RECONCILER_SCHEMA_VERSION,
  type CapabilityMap,
  type CapabilityRequirement,
  type ChangePlan,
  type Diagnostic,
  type InstallPackageIntent,
  type InstallPlanDependencies,
  type LockfileState,
  type PackageBundle,
  type PlanConflict,
  type PlanStep,
  type ReconcileInput,
  type VersionMeta,
} from "./types.js";

export async function planInstallPackage(
  input: ReconcileInput,
  intent: InstallPackageIntent,
  deps: InstallPlanDependencies,
): Promise<ChangePlan> {
  const rootMeta = await deps.packageMeta(intent.packageName);
  const root = pickVersion(
    rootMeta,
    intent.versionSpec ?? "",
    input.target.platform,
  );

  if (!root) {
    const conflict = unsupportedPlatformConflict(intent.packageName);
    return basePlan(input, intent, {
      conflicts: [conflict],
      diagnostics: [],
      previewPackages: [],
      previewFunctions: [],
      steps: [],
    });
  }

  let transitivePackages;
  try {
    transitivePackages = await resolveDeps(
      intent.packageName,
      root.version,
      deps.packageMeta,
      toLockfile(input.lockfile),
      input.target.platform,
    );
  } catch (error) {
    if (!(error instanceof ResolveError)) {
      throw error;
    }

    return dependencyResolutionBlockedPlan(input, intent, error);
  }
  const packages = [
    ...transitivePackages.map((pkg) => ({ ...pkg, direct: false })),
    {
      name: intent.packageName,
      version: root.version,
      meta: root.meta,
      direct: true,
    },
  ];
  const packageVersions = Object.fromEntries(
    packages.map((pkg) => [pkg.name, pkg.version]),
  );

  const bundles = await Promise.all(
    packages.map(async (pkg) => ({
      ...pkg,
      bundle: await deps.packageBundle(pkg.name, pkg.version, pkg.meta),
    })),
  );

  const steps = bundles.flatMap((pkg) =>
    createPackageSteps(
      pkg.name,
      pkg.version,
      pkg.meta,
      pkg.bundle,
      input.target.platform,
    ),
  );
  steps.push(
    {
      id: "write-project-metadata",
      kind: "write-project-metadata",
      label: "Write project metadata",
      capability: "writeMetadata",
      reversible: true,
    },
    {
      id: "write-lockfile",
      kind: "write-lockfile",
      label: "Write lockfile",
      capability: "writeLockfile",
      reversible: true,
    },
    {
      id: "verify-function",
      kind: "verify-function",
      label: "Verify installed functions",
      capability: "listFunctions",
      reversible: false,
    },
    {
      id: "verify-lockfile",
      kind: "verify-lockfile",
      label: "Verify lockfile",
      capability: "readLockfile",
      reversible: false,
    },
  );

  const requiredCapabilities = requiredCapabilitiesForSteps(steps);
  const capabilityConflicts = missingCapabilityConflicts(
    input,
    requiredCapabilities,
  );
  const collisionConflicts = functionCollisionConflicts(
    input,
    steps,
    packageVersions,
  );
  const diagnostics = missingCapabilityDiagnostics(input, requiredCapabilities);

  return basePlan(input, intent, {
    conflicts: [...collisionConflicts, ...capabilityConflicts],
    diagnostics,
    previewPackages: packages.map((pkg) => ({
      name: pkg.name,
      version: pkg.version,
      direct: pkg.direct,
    })),
    previewFunctions: steps
      .filter((step) => step.kind === "create-function" && step.functionName)
      .map((step) => ({ name: step.functionName!, action: "create" })),
    requiredCapabilities,
    steps,
  });
}

export function toLockfile(lockfile: LockfileState): Lockfile {
  return {
    packages: Object.fromEntries(
      Object.entries(lockfile.packages).map(([name, entry]) => [
        name,
        {
          version: entry.version,
          resolved: entry.resolved,
          integrity: entry.integrity,
          dependencies: [...entry.dependencies],
          functions: [...entry.functions],
        },
      ]),
    ),
  };
}

function basePlan(
  input: ReconcileInput,
  intent: InstallPackageIntent,
  options: {
    conflicts: PlanConflict[];
    diagnostics: Diagnostic[];
    previewPackages: ChangePlan["preview"]["packages"];
    previewFunctions: ChangePlan["preview"]["functions"];
    requiredCapabilities?: CapabilityRequirement[];
    steps: PlanStep[];
  },
): ChangePlan {
  const blockedBy = options.conflicts
    .filter((conflict) => conflict.severity === "blocking")
    .map((conflict) => conflict.id);

  return {
    schemaVersion: RECONCILER_SCHEMA_VERSION,
    id: `install-package:${intent.packageName}`,
    kind: "install-package",
    target: input.target,
    title: `Install ${intent.packageName}`,
    summary: `Plan install of ${intent.packageName}.`,
    steps: options.steps,
    conflicts: options.conflicts,
    warnings: [],
    diagnostics: [...input.diagnostics, ...options.diagnostics],
    requiredCapabilities: options.requiredCapabilities ?? [],
    preview: {
      packages: options.previewPackages,
      functions: options.previewFunctions,
    },
    applyPolicy: {
      applicable: blockedBy.length === 0,
      blockedBy,
      verification: "required",
    },
  };
}

function createPackageSteps(
  packageName: string,
  version: string,
  meta: VersionMeta,
  bundle: PackageBundle,
  platform: ReconcileInput["target"]["platform"],
): PlanStep[] {
  const functions = resolveFunctions(bundle, platform);
  const steps: PlanStep[] = [
    {
      id: `download-artifact:${packageName}`,
      kind: "download-artifact",
      label: `Download ${packageName}`,
      packageName,
      after: meta.artifact,
      capability: "readMetadata",
      reversible: false,
    },
    {
      id: `verify-integrity:${packageName}`,
      kind: "verify-integrity",
      label: `Verify ${packageName} integrity`,
      packageName,
      after: meta.integrity,
      capability: "readMetadata",
      reversible: false,
    },
  ];

  for (const [name, fn] of Object.entries(functions)) {
    steps.push({
      id: `create-function:${name}`,
      kind: "create-function",
      label: `Create ${name}`,
      packageName,
      functionName: name,
      after: toNamedFunction(name, fn),
      capability: "createFunction",
      reversible: true,
    });
  }

  return steps;
}

function toNamedFunction(
  name: string,
  fn: PackageBundle["functions"][string],
): NamedFunction {
  return {
    name,
    definition: fn.definition,
    description: fn.description,
    arguments: Object.keys(fn.arguments),
    argumentDescriptions: Object.fromEntries(
      Object.entries(fn.arguments).map(([argName, arg]) => [
        argName,
        arg.description,
      ]),
    ),
    argumentExamples: Object.fromEntries(
      Object.entries(fn.arguments).map(([argName, arg]) => [
        argName,
        arg.example,
      ]),
    ),
  };
}

function functionCollisionConflicts(
  input: ReconcileInput,
  steps: PlanStep[],
  packageVersions: Record<string, string>,
): PlanConflict[] {
  return steps
    .filter((step) => step.kind === "create-function" && step.functionName)
    .flatMap((step) => {
      const existing = input.workbook.functions[step.functionName!];
      if (
        !existing ||
        (existing.origin.kind === "package" &&
          existing.origin.packageName === step.packageName &&
          existing.origin.version === packageVersions[step.packageName!])
      ) {
        return [];
      }

      return [
        {
          id: `function-name-collision:${step.functionName}`,
          severity: "blocking",
          kind: "function-name-collision",
          message: `${step.functionName} already exists outside package management.`,
          functionName: step.functionName,
          packageName: step.packageName,
          resolutions: [
            { id: "skip", label: "Skip function", effect: "skip" },
            { id: "replace", label: "Replace function", effect: "replace" },
            { id: "abort", label: "Abort install", effect: "abort" },
          ],
        } satisfies PlanConflict,
      ];
    });
}

function requiredCapabilitiesForSteps(
  steps: PlanStep[],
): CapabilityRequirement[] {
  const capabilities = new Set<keyof CapabilityMap>();
  for (const step of steps) {
    capabilities.add(step.capability);
  }

  return [...capabilities].map((capability) => ({
    capability,
    acceptableLevels: ["direct"],
  }));
}

function missingCapabilityConflicts(
  input: ReconcileInput,
  requiredCapabilities: CapabilityRequirement[],
): PlanConflict[] {
  return requiredCapabilities.flatMap(({ capability, acceptableLevels }) => {
    if (
      acceptableLevels.some(
        (level) => level === input.capabilities[capability].level,
      )
    ) {
      return [];
    }

    return [
      {
        id: `required-capability-unavailable:${capability}`,
        severity: "blocking",
        kind: "required-capability-unavailable",
        message: `${capability} is required to install packages.`,
        resolutions: [
          { id: "abort", label: "Abort install", effect: "abort" },
        ],
      } satisfies PlanConflict,
    ];
  });
}

function missingCapabilityDiagnostics(
  input: ReconcileInput,
  requiredCapabilities: CapabilityRequirement[],
): Diagnostic[] {
  return requiredCapabilities.flatMap(({ capability, acceptableLevels }) => {
    if (
      acceptableLevels.some(
        (level) => level === input.capabilities[capability].level,
      )
    ) {
      return [];
    }

    return [
      {
        severity: "error",
        code: "required-capability-unavailable",
        message: `${capability} is required to install packages.`,
        targetId: input.target.id,
        subject: { type: "capability", id: capability },
      } satisfies Diagnostic,
    ];
  });
}

function unsupportedPlatformConflict(packageName: string): PlanConflict {
  return {
    id: `unsupported-platform-rendering:${packageName}`,
    severity: "blocking",
    kind: "unsupported-platform-rendering",
    message: `${packageName} has no compatible version for this platform.`,
    packageName,
    resolutions: [{ id: "abort", label: "Abort install", effect: "abort" }],
  };
}

function dependencyResolutionBlockedPlan(
  input: ReconcileInput,
  intent: InstallPackageIntent,
  error: ResolveError,
): ChangePlan {
  return basePlan(input, intent, {
    conflicts: [dependencyVersionConflict(intent.packageName, error.message)],
    diagnostics: [
      {
        severity: "error",
        code: "undeclared-dependency",
        message: error.message,
        targetId: input.target.id,
        subject: { type: "dependency", id: intent.packageName },
      },
    ],
    previewPackages: [],
    previewFunctions: [],
    steps: [],
  });
}

function dependencyVersionConflict(
  packageName: string,
  message: string,
): PlanConflict {
  return {
    id: `dependency-version-conflict:${packageName}`,
    severity: "blocking",
    kind: "dependency-version-conflict",
    message,
    packageName,
    resolutions: [{ id: "abort", label: "Abort install", effect: "abort" }],
  };
}
