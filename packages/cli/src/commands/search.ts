/**
 * `formulary search [query]` — browse the registry.
 *
 * Fetches index.json, filters by name + description (case-insensitive
 * substring), prints a table sorted by name. With no query, lists all
 * packages.
 */

import { RegistryClient } from "@formulary/core";
import type { RegistryIndex } from "@formulary/core";
import { fetchJSON } from "../network.js";

const REGISTRY_BASE =
  process.env.FORMULARY_REGISTRY ??
  "https://raw.githubusercontent.com/Astral1119/formulary-registry/main";

export async function search(query?: string): Promise<void> {
  const registry = new RegistryClient(REGISTRY_BASE);
  const data = await fetchJSON(registry.indexUrl());
  const index = registry.parseIndex(data) as RegistryIndex;

  const all = Object.entries(index.packages ?? {});
  if (all.length === 0) {
    console.log("Registry is empty.");
    return;
  }

  const q = (query ?? "").trim().toLowerCase();
  const matches = q
    ? all.filter(([name, entry]) => {
        const desc = (entry.description ?? "").toLowerCase();
        return name.toLowerCase().includes(q) || desc.includes(q);
      })
    : all;

  if (matches.length === 0) {
    console.log(`No packages match "${query}".`);
    return;
  }

  matches.sort(([a], [b]) => a.localeCompare(b));

  // Compute column widths
  const nameW = Math.max(4, ...matches.map(([n]) => n.length));
  const verW = Math.max(7, ...matches.map(([, e]) => (e.latest ?? "").length));

  for (const [name, entry] of matches) {
    const platforms = entry.platforms?.length
      ? entry.platforms.join(",")
      : "?";
    const desc = entry.description ?? "";
    console.log(
      `  ${name.padEnd(nameW)}  ${(entry.latest ?? "").padEnd(verW)}  [${platforms}]  ${desc}`,
    );
  }

  console.log(
    `\n${matches.length} package${matches.length === 1 ? "" : "s"}` +
      (q ? ` matching "${query}"` : ""),
  );
}
