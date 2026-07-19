# Formulary — Agent Reference

A focused reference for agents authoring spreadsheet packages with formulary. Covers the full workflow: create → iterate → test → publish.

## What formulary is

Formulary is a package manager for spreadsheet named functions (LAMBDA-based). Packages contain:

- **`manifest.json`** — name, version, owners, dependencies, exports, platforms
- **`functions.json`** — the actual LAMBDAs (definition + description + arguments)
- **`functions.{platform}.json`** — optional per-platform overrides (excel/gsheets)
- **`tests/*.yaml`** — optional assay test suites
- **`README.md`** — optional

Authoring is **directory-first** for agents: edit JSON files in a local directory, then publish. The workbook is just a deployment target.

The registry lives at `https://raw.githubusercontent.com/Astral1119/formulary-registry/main`. Currently contains `charter` (the type system / object protocol foundation that most other packages depend on).

## Quick reference

```
formulary new <target>                       create a new project
  formulary new ./mypkg                        directory mode (use this)
  formulary new mypkg.xlsx                     local xlsx workbook
  formulary new --gsheets --name x             new google sheet (creates in Drive)

formulary dev <pkg> [target]                 fetch an existing package as a workspace

formulary use <name>                         switch active project
formulary projects                           list known projects
formulary forget <name>                      remove project from local registry (doesn't delete files)

formulary check [dir]                        validate manifest + preflight
formulary test                               run tests/ against the active project
formulary preview                            build a temp xlsx with project + deps installed
formulary preview --teardown                 remove the preview workbook

formulary version                            show current version
formulary version bump (major|minor|patch)   bump version
formulary version set <x.y.z>                set explicit version

formulary search [query]                     browse the registry
formulary info <pkg>                         show package details

formulary install <pkg> [target]             install a package (uses active project if target omitted)
formulary remove <pkg> [target]              remove a package + orphaned deps
formulary upgrade <pkg> [target]             upgrade to latest compatible
formulary list [target]                      list installed packages

formulary pack [dir]                         build a .fpkg from a directory
formulary publish [dir-or-fpkg]              publish to the registry via PR
formulary publish --dry-run                  preview without publishing

formulary auth [profile]                     sign in with Google + GitHub
formulary auth list                          list profiles
formulary auth remove <profile>              delete a profile

formulary extract --output <dir>             extract functions from a workbook to a directory
formulary init [file.xlsx]                   create an empty workbook with metadata sheets
```

Most workbook-targeting commands accept `--gsheets <url>`, `--profile <name>`, `--headed` flags.

## Mental model

### Project

A **project** is the unit of authoring. It has a target (directory, xlsx, or google sheet) and a manifest. The local "active project" is tracked in `~/.formulary/projects.json` so commands work without explicit paths once you've run `formulary new` or `formulary use <name>`.

For agents, use **directory projects**:

```bash
formulary new ./my-utils --depends-on charter
# active project is now ./my-utils
formulary check                              # works
formulary publish                            # works
```

### Manifest

The minimum manifest for a publishable package:

```json
{
  "name": "my-utils",
  "version": "0.1.0",
  "description": "What this package does",
  "owners": [],
  "license": "MIT",
  "dependencies": { "charter": "*" },
  "exports": [],
  "platforms": ["excel"]
}
```

Notes:
- `owners` can be empty — your GitHub username gets auto-added on publish
- `exports` is auto-derived from `functions.json` at publish time, no need to maintain manually
- `dependencies` uses npm-style version specifiers: `"*"` (any), `"1.0.0"` (exact), `">=1.0.0"`, `"^1.0.0"`, `"~1.0.0"`
- `platforms` controls which platforms can install the package; `["excel"]` is the default for charter-dependent packages because charter is excel-only

### Functions

`functions.json` is the authoring surface. Format:

```json
{
  "MY_FUNC": {
    "definition": "LAMBDA(x, x * 2)",
    "description": "Doubles a number",
    "arguments": {
      "x": { "description": "Number to double", "example": "21" }
    }
  }
}
```

Notes:
- The `=` prefix is **omitted** from `definition`. It's added automatically on install.
- LAMBDAs can call other functions from the same package or from any installed dependency directly: `LAMBDA(x, HASH(x) * 2)` works if charter is in dependencies.
- Names should be UPPER_CASE_WITH_UNDERSCORES by convention.
- Names must NOT contain dots (Google Sheets restriction). Use `MY_FUNC` not `MY.FUNC`.
- Names must NOT collide with built-in spreadsheet functions or charter exports unless the package explicitly intends to shadow them.

### Lockfile

Tracked automatically in workbook hidden sheets. Records exact dependency versions installed. Not edited by hand. The publish flow excludes any function that's listed in the lockfile (those are dependency functions, not your own).

## Common workflows

### A. Create a new package on top of charter

```bash
formulary new ./my-utils --depends-on charter --description "Helpers built on charter"
# write functions.json with your LAMBDAs
formulary check                              # validate as you go
formulary test                               # run any tests in tests/
formulary publish                            # PR opens, auto-merges if you're a trusted author
```

After publish, the package is in the registry and other projects can `formulary install my-utils`.

### B. Update an existing package you own

```bash
formulary dev my-utils                       # fetches latest version into ./my-utils
# edit functions.json
formulary version bump patch                 # 0.1.0 → 0.1.1
formulary check
formulary test
formulary publish
```

### C. Test that your package works as a consumer

```bash
formulary new ./test-consumer --depends-on my-utils
# write test functions in functions.json that use my-utils's exports
formulary check
formulary test
```

### D. Inspect a package without installing

```bash
formulary info my-utils                      # shows version, owners, deps, exports, integrity
formulary search                             # list everything in the registry
formulary search hash                        # filter by name+description
```

### E. Manually verify in Excel (less common for agents)

```bash
formulary preview                            # builds temp xlsx at /tmp/formulary-previews/<name>.xlsx
open "/tmp/formulary-previews/my-utils.xlsx" # macOS only
# inspect in Excel
formulary preview --teardown                 # removes the file
```

## Conventions

### Active project

Most commands fall back to the active project when no target is given. Set with `formulary new` (auto) or `formulary use <name>`. Show with `formulary projects`.

The active project is **stored locally** in `~/.formulary/projects.json`. If you switch terminals or machines, you have to re-establish.

### Auth

Two auth surfaces, both initialized via `formulary auth`:

1. **GitHub** (via `gh auth login`) — needed for `formulary publish`. The CLI shells out to `gh`. If you don't have `gh` installed or authenticated, publish fails with a clear message.
2. **Google** (via formulary's OAuth flow) — needed for `--gsheets` operations. Runs an OAuth web flow once, stores token at `~/.formulary/profiles/<name>/token.json`. Reused across sessions. Requires `~/.formulary/credentials.json` (OAuth client credentials from Google Cloud Console).

For directory-only authoring (no `--gsheets`), you only need GitHub auth.

### Versioning

Always semver. The `version bump` subcommand resets lower components correctly:
- `bump major`: `1.2.3` → `2.0.0`
- `bump minor`: `1.2.3` → `1.3.0`
- `bump patch`: `1.2.3` → `1.2.4`

Pre-release suffixes (`1.0.0-rc.1`) are accepted by `version set` but not by `version bump`. Don't try to bump from a pre-release.

**Versions are immutable once published.** You cannot republish the same version. Always bump.

### Dependencies

Direct dependencies go in `manifest.json`. Transitive dependencies are resolved at install/test/publish time and tracked in the lockfile.

Cross-platform dependencies (different deps per platform) use `platformDependencies`:

```json
{
  "dependencies": { "charter": "*" },
  "platformDependencies": {
    "excel": { "excel-shims": ">=0.1.0" }
  }
}
```

### Exports

`manifest.json`'s `exports` field is **derived from `functions.json`** at publish time. You don't need to maintain it. Adding/removing functions automatically updates exports.

### Forbidden functions

The registry rejects any package whose function definitions reference exfiltration functions: `WEBSERVICE`, `IMAGE`, `HYPERLINK`, `IMPORTDATA`, `IMPORTHTML`, `IMPORTXML`, `IMPORTRANGE`. The check runs in `formulary check`, in publish preflight, and in registry CI.

If you genuinely need one of these (e.g., a real image function), publishing requires manual review. Don't try to obscure the call.

## Errors and recovery

### `cannot resolve <pkg> (<spec>)`

The registry doesn't have a version of `<pkg>` matching `<spec>`. Check `formulary search` and `formulary info <pkg>` to see what's available. If the package doesn't exist at all, you may need to publish it first.

### `manifest is well-formed: ...`

Structural validation failed. Fix the field mentioned in the detail. Common causes:
- `name` not lowercase / has illegal characters
- `version` isn't semver
- `platforms` is empty

### `description set: add a description...`

Required for publish, optional during authoring. Edit `manifest.json`.

### `at least one function (0): no functions to publish`

Empty `functions.json`. Add LAMBDAs.

### `no exfiltration functions: package uses WEBSERVICE — not allowed`

A function definition references a forbidden function. Remove or rename.

### `Preflight failed (N checks). Fix the issues above, or pass --force to publish anyway.`

`formulary publish` blocks unless all checks pass. `--force` skips the block but the registry CI still runs the same checks and will reject. Use `--force` only for development testing against a local registry (`FORMULARY_REGISTRY=...`).

### `unauthorized: <user> is not an owner of '<pkg>'. current owners: [...]`

You're trying to publish a new version of a package owned by someone else. Either get added to the owners list, or fork into your own scoped name.

### `cannot modify existing version <pkg>@<ver>`

Versions are immutable. Bump and republish.

### `GitHub CLI not authenticated. Run: gh auth login`

`formulary publish` needs `gh` authenticated. Run `gh auth login` and retry.

### `no active project. run \`formulary use <name>\` or pass a directory`

You ran a command that needs a project context but there's no active project. Either set one with `formulary use` or pass an explicit path/target.

### `formulary test` errors

- **`xlwings not available. Run: assay setup`** — assay's Python venv isn't set up. Run `assay setup` from `~/sandbox/current/assay`.
- **`workbook X not found`** — the temp workbook build failed. Check the output above for the actual reason (usually a dep resolution failure).

## Environment

- **Registry override:** set `FORMULARY_REGISTRY=<url>` to point at a different registry (useful for testing against a local file server or staging registry)
- **OAuth credentials:** `~/.formulary/credentials.json` — needed for Google Sheets API operations
- **Auth tokens:** `~/.formulary/profiles/<name>/token.json` — refresh-able OAuth tokens
- **Project state:** `~/.formulary/projects.json` — local project registry
- **Preview state:** `~/.formulary/previews.json` — tracks active preview workbooks

## Related tools

- **assay** (`~/sandbox/current/assay`) — test runner used by `formulary test`. Imported as a library. Has its own CLI for direct test running, fixture management, and per-platform comparison. See `assay --help`.
- **charter** (`~/sandbox/current/charter`) — the type system / object protocol package. Already published. Most other packages should depend on it.
- **formulary-registry** (`~/sandbox/current/formulary-registry`) — the registry repo. New format: `index.json` + `packages/{name}/meta.json` + `packages/{name}/{version}/{name}-{version}.fpkg`. CI script at `.github/scripts/validate_package.py` runs the same checks as `formulary check` plus integrity verification and ownership.
- **formulary-auth-worker** (`packages/auth-worker/`) — Cloudflare Worker that proxies GitHub OAuth for the Excel add-in. Not used by agents directly.

## Files an agent should know about

| Path | What |
|---|---|
| `manifest.json` | package metadata; agent edits this |
| `functions.json` | LAMBDA definitions; agent edits this |
| `tests/*.yaml` | assay test suites; agent writes these |
| `~/.formulary/projects.json` | active project state; managed by formulary |
| `~/.formulary/credentials.json` | OAuth credentials; one-time setup |
| `~/.formulary/profiles/*/token.json` | OAuth tokens; managed by `formulary auth` |

## Where things get awkward

- **GSheets workflows are slow** because they use Playwright UI automation. Prefer Excel-target tests for speed; only use `--gsheets` when actually verifying gsheets behavior.
- **`formulary publish` opens a PR** rather than directly publishing. For trusted authors the PR auto-merges within ~30s. For others it waits for manual review. Either way, the registry update isn't instant.
- **`formulary test` needs xlwings** — Python + Excel running locally. If you don't have Excel installed, you can't `formulary test` for Excel-target packages.
- **`formulary new --gsheets` is the only way to get a fresh sheet via API**, but it requires Google OAuth credentials and Playwright (for the metadata sheet init). It's not as fast as directory mode.

## When things break

1. **Run `formulary check` first.** It'll catch most authoring errors before they hit the network.
2. **Look at the output verbatim.** Errors are designed to be actionable; they say what to fix.
3. **Use `--dry-run` on publish** to verify the flow without making a PR.
4. **`formulary projects`** to see what state you're in.
5. **`formulary info <pkg>`** to verify what's in the registry.
6. **For test failures, the divergence between expected and actual is printed** — check the formula and the function definitions.

## Symbiotic loop with assay

The expected workflow when authoring on top of charter:

```bash
# bootstrap
formulary new ./my-pkg --depends-on charter --description "..."

# write tests first (optional but recommended)
# tests/basic.yaml:
#   tests:
#     - name: my function works
#       formula: '=MY_FUNC(1, 2)'
#       expect: 3

formulary test                               # run tests — they'll fail (no MY_FUNC yet)

# write functions.json with the implementation
# {
#   "MY_FUNC": { "definition": "LAMBDA(a, b, a + b)", ... }
# }

formulary test                               # tests pass

formulary check                              # final validation
formulary publish                            # ship it
```

If you need to inspect intermediate behavior in real Excel:

```bash
formulary preview
open "/tmp/formulary-previews/my-pkg.xlsx"
# poke at things in Excel
formulary preview --teardown
```
