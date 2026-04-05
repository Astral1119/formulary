/**
 * Minimal semver parsing and constraint matching.
 * No external dependencies — must work in Apps Script IIFE bundle.
 */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

export function parseSemVer(version: string): SemVer | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function compareSemVer(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

export function semVerToString(v: SemVer): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

/**
 * Parse a version specifier like ">=1.2.0", "^1.0.0", "1.0.0".
 * Returns a predicate that tests whether a version satisfies the constraint.
 */
export function parseConstraint(
  specifier: string,
): ((version: SemVer) => boolean) | null {
  const trimmed = specifier.trim();
  if (!trimmed) return () => true; // empty = any version

  // exact: "1.2.3"
  const exact = parseSemVer(trimmed);
  if (exact) {
    return (v) => compareSemVer(v, exact) === 0;
  }

  // >=X.Y.Z
  const gte = /^>=\s*(.+)$/.exec(trimmed);
  if (gte) {
    const min = parseSemVer(gte[1]);
    if (!min) return null;
    return (v) => compareSemVer(v, min) >= 0;
  }

  // >X.Y.Z
  const gt = /^>\s*(.+)$/.exec(trimmed);
  if (gt) {
    const min = parseSemVer(gt[1]);
    if (!min) return null;
    return (v) => compareSemVer(v, min) > 0;
  }

  // <=X.Y.Z
  const lte = /^<=\s*(.+)$/.exec(trimmed);
  if (lte) {
    const max = parseSemVer(lte[1]);
    if (!max) return null;
    return (v) => compareSemVer(v, max) <= 0;
  }

  // <X.Y.Z
  const lt = /^<\s*(.+)$/.exec(trimmed);
  if (lt) {
    const max = parseSemVer(lt[1]);
    if (!max) return null;
    return (v) => compareSemVer(v, max) < 0;
  }

  // ^X.Y.Z — compatible with (same major, >= specified)
  const caret = /^\^\s*(.+)$/.exec(trimmed);
  if (caret) {
    const min = parseSemVer(caret[1]);
    if (!min) return null;
    return (v) => v.major === min.major && compareSemVer(v, min) >= 0;
  }

  // ~X.Y.Z — approximately (same major.minor, >= specified)
  const tilde = /^~\s*(.+)$/.exec(trimmed);
  if (tilde) {
    const min = parseSemVer(tilde[1]);
    if (!min) return null;
    return (v) =>
      v.major === min.major &&
      v.minor === min.minor &&
      compareSemVer(v, min) >= 0;
  }

  return null; // unrecognized
}

/** Check if a version string satisfies a specifier string. */
export function satisfies(version: string, specifier: string): boolean {
  const v = parseSemVer(version);
  if (!v) return false;
  const pred = parseConstraint(specifier);
  if (!pred) return false;
  return pred(v);
}
