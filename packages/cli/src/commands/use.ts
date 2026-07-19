/**
 * `formulary use <name>` — switch the active project.
 * `formulary projects`   — list known projects.
 * `formulary forget <name>` — remove a project from the registry.
 */

import {
  setActive,
  listProjects,
  forgetProject,
  describeTarget,
} from "../projects.js";

export function useProject(name: string): void {
  const project = setActive(name);
  console.log(`✓ active project: ${project.name}`);
  console.log(`  ${describeTarget(project.target)}`);
}

export function projectsList(): void {
  const { active, all } = listProjects();
  if (all.length === 0) {
    console.log("No projects yet. Use `formulary new <target>` to create one.");
    return;
  }

  for (const p of all) {
    const marker = p.name === active ? "▸" : " ";
    const target = describeTarget(p.target);
    console.log(`  ${marker} ${p.name}  [${p.platform}]  ${target}`);
  }
  if (active) {
    console.log(`\n  active: ${active}`);
  } else {
    console.log(`\n  no active project (run \`formulary use <name>\`)`);
  }
}

export function forgetProjectCommand(name: string): void {
  if (forgetProject(name)) {
    console.log(`✓ removed project "${name}" from the registry`);
    console.log(`  (the workbook/directory itself was not deleted)`);
  } else {
    console.error(`project "${name}" not found`);
    process.exit(1);
  }
}
