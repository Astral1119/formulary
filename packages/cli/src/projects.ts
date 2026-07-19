/**
 * Local project registry.
 *
 * Tracks projects (workbooks, GSheets, package directories) the user has
 * worked with so commands can operate on the "active" one without
 * requiring an explicit target argument every time.
 *
 * Stored at ~/.formulary/projects.json. The intrinsic state (manifest,
 * lockfile) still lives in the workbook itself — this file is just an
 * index for navigation.
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Platform } from "@formulary/core";

const FORMULARY_DIR = join(homedir(), ".formulary");
const PROJECTS_FILE = join(FORMULARY_DIR, "projects.json");

export type ProjectTarget =
  | { kind: "directory"; path: string }
  | { kind: "xlsx"; path: string }
  | { kind: "gsheets"; spreadsheetId: string; url: string; profile: string };

export interface Project {
  /** Human-readable name (defaults to package name or target basename). */
  name: string;
  target: ProjectTarget;
  /** ISO 8601 timestamp. */
  lastAccessed: string;
  /** Platform the project's primary target supports. */
  platform: Platform;
}

export interface ProjectsConfig {
  active?: string;
  projects: Record<string, Project>;
}

// ─── Load / save ──────────────────────────────────────────────────

export function loadProjects(): ProjectsConfig {
  if (!existsSync(PROJECTS_FILE)) {
    return { projects: {} };
  }
  try {
    return JSON.parse(readFileSync(PROJECTS_FILE, "utf8"));
  } catch {
    return { projects: {} };
  }
}

export function saveProjects(config: ProjectsConfig): void {
  mkdirSync(FORMULARY_DIR, { recursive: true });
  writeFileSync(PROJECTS_FILE, JSON.stringify(config, null, 2) + "\n");
}

// ─── Operations ───────────────────────────────────────────────────

/**
 * Register a project. If `name` already exists, the entry is updated
 * (target/platform refreshed). Sets `active` to the new project.
 */
export function registerProject(project: Project): void {
  const config = loadProjects();
  config.projects[project.name] = {
    ...project,
    lastAccessed: new Date().toISOString(),
  };
  config.active = project.name;
  saveProjects(config);
}

export function getActive(): Project | null {
  const config = loadProjects();
  if (!config.active) return null;
  const project = config.projects[config.active];
  return project ?? null;
}

export function setActive(name: string): Project {
  const config = loadProjects();
  const project = config.projects[name];
  if (!project) {
    throw new Error(
      `Project "${name}" not found. Run \`formulary projects\` to see known projects.`,
    );
  }
  config.active = name;
  config.projects[name] = {
    ...project,
    lastAccessed: new Date().toISOString(),
  };
  saveProjects(config);
  return project;
}

export function forgetProject(name: string): boolean {
  const config = loadProjects();
  if (!(name in config.projects)) return false;
  delete config.projects[name];
  if (config.active === name) {
    delete config.active;
  }
  saveProjects(config);
  return true;
}

export function listProjects(): { active: string | undefined; all: Project[] } {
  const config = loadProjects();
  const all = Object.values(config.projects).sort((a, b) =>
    b.lastAccessed.localeCompare(a.lastAccessed),
  );
  return { active: config.active, all };
}

// ─── Resolution helpers ───────────────────────────────────────────

/**
 * Describe a target as a one-line string for display.
 */
export function describeTarget(target: ProjectTarget): string {
  switch (target.kind) {
    case "directory":
      return `dir: ${target.path}`;
    case "xlsx":
      return `xlsx: ${target.path}`;
    case "gsheets":
      return `gsheets: ${target.url}`;
  }
}

/**
 * Build a project entry from a directory path. Used by `formulary new`
 * and any command that wants to register a freshly-created project.
 */
export function projectFromDirectory(
  name: string,
  dirPath: string,
  platforms: Platform[],
): Project {
  return {
    name,
    target: { kind: "directory", path: resolve(dirPath) },
    lastAccessed: new Date().toISOString(),
    platform: platforms[0] ?? "excel",
  };
}

export function projectFromXlsx(
  name: string,
  xlsxPath: string,
): Project {
  return {
    name,
    target: { kind: "xlsx", path: resolve(xlsxPath) },
    lastAccessed: new Date().toISOString(),
    platform: "excel",
  };
}

export function projectFromGSheets(
  name: string,
  spreadsheetId: string,
  url: string,
  profile: string,
): Project {
  return {
    name,
    target: { kind: "gsheets", spreadsheetId, url, profile },
    lastAccessed: new Date().toISOString(),
    platform: "gsheets",
  };
}
