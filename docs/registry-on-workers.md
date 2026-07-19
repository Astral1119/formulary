# Registry on Cloudflare Workers — Design Doc

## Context

Formulary's registry currently lives on GitHub: a static repo at `Astral1119/formulary-registry` served via `raw.githubusercontent.com`. Publishing happens via fork → PR → merge. Installs read static files.

This works for closed beta but has known friction:
- **Awkward publish flow**: every publish is a PR. From the Excel add-in, this means a complex multi-step REST API dance using the GitHub git data API.
- **No real concurrency model**: two simultaneous publishes both modifying `index.json` produce merge conflicts.
- **Limited policy enforcement**: validation lives in CI scripts in the registry repo, separate from the install path.
- **No analytics or query API**: we can't see what's being installed, popular packages, etc.
- **Tied to GitHub specifically**: terms-of-service risk, no alternative if the model breaks.

This doc designs a worker-served registry as the **next** state, not the current one. The migration is deferred until we hit real pain or have real users. This is the same path **crates.io** took: started with a Git index on GitHub, migrated to a sparse HTTP index at `index.crates.io` in 2023 when the Git-based system hit scaling limits, kept the GitHub repo as source of truth.

## Goals

1. **Direct authenticated publish** — no fork/PR dance. Publishing is a single HTTPS POST to the registry, authenticated with a GitHub OAuth token.
2. **Server-side policy enforcement** — manifest validation, integrity check, exfiltration check happen at the registry on every publish. CI scripts go away.
3. **Backwards-compatible install path** — existing CLI and add-in install code uses the same `index.json` + per-package `meta.json` shape. We swap the URL and they keep working.
4. **Same domain as the OAuth worker** (`formulary.dev`) so we have one piece of infrastructure to maintain.
5. **GitHub mirror for transparency** — every publish is also pushed to the GitHub registry repo as a backup and audit log. If the worker goes down, installs can fall back to raw.githubusercontent.com.

## Non-goals

- **No new package format**. The `.fpkg` format and registry file shapes (`index.json`, `meta.json`) stay the same. This is a storage/serving change, not a format migration.
- **No new auth model**. GitHub OAuth via the existing OAuth worker. No separate accounts.
- **No registry browsing UI yet**. The registry is an API; the add-in's Browse tab is the UI. A web UI on `formulary.dev` is a future addition.
- **No replacing the resolver or installer**. Those are pure logic in `@formulary/core` and don't change.

## Architecture

```
                   ┌──────────────────────┐
   formulary.dev   │ Cloudflare Worker    │
   ──────────────▶ │                      │
                   │  /auth/github/*      │ ── GitHub OAuth
                   │  /registry/*         │
                   └──────┬───────────────┘
                          │
              ┌───────────┼─────────────────┐
              ▼           ▼                 ▼
        ┌─────────┐  ┌─────────┐    ┌──────────────┐
        │   R2    │  │  D1     │    │ GitHub       │
        │ .fpkg   │  │ index   │    │ mirror repo  │
        │ blobs   │  │ + meta  │    │ (backup)     │
        └─────────┘  └─────────┘    └──────────────┘
```

**Storage:**
- **R2** — `.fpkg` artifacts. Object store, infinite scale, free tier covers 10 GB.
- **D1** (SQLite at the edge) — package index, version metadata, owners, integrity hashes. Queryable for browse/search/policy. Alternative: KV if we don't need queries.
- **GitHub mirror** — async background job pushes a copy of every change to the existing `formulary-registry` repo. Source of truth for transparency, backup, and disaster recovery.

**Routes** (all under `formulary.dev`):

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/auth/github/start` | GET | none | OAuth start (already in plan) |
| `/auth/github/callback` | GET | none | OAuth code → token exchange (already in plan) |
| `/registry/index.json` | GET | none | Package list (compat with current shape) |
| `/registry/packages/:name/meta.json` | GET | none | Per-package metadata (compat) |
| `/registry/packages/:name/:version/:filename.fpkg` | GET | none | Artifact download (compat path shape) |
| `/registry/publish` | POST | GitHub OAuth | Authenticated publish |
| `/registry/yank/:name/:version` | POST | GitHub OAuth | Mark a version yanked |
| `/registry/owners/:name` | POST | GitHub OAuth | Add/remove owners |
| `/registry/search?q=...` | GET | none | (future) Full-text search |
| `/registry/stats/:name` | GET | none | (future) Install counts |

The four read routes (`index.json`, `meta.json`, `:name/:version.fpkg`, eventual search) are what the CLI and add-in already call. We change `REGISTRY_BASE` from `raw.githubusercontent.com/...` to `formulary.dev/registry`. Done.

## Publish flow (worker-side)

`POST /registry/publish` accepts:
- Header: `Authorization: Bearer <github_oauth_token>`
- Body: multipart form with `manifest` (JSON) and `fpkg` (binary)

Worker:

1. **Verify token** — call `api.github.com/user` with the bearer token, get the publisher's GitHub username.
2. **Parse and validate manifest** — same `validateManifest` from core (we can ship it as a worker-bundled module).
3. **Compute and verify integrity** — hash the .fpkg, compare to the integrity field in the request.
4. **Run exfiltration check** — same policy check from `publish-flow.ts` (also from core eventually).
5. **Check ownership** — query D1 for existing owners of `manifest.name`. If package exists and publisher isn't an owner, reject. If package is new, publisher becomes the first owner.
6. **Check version** — must be a new version greater than the current latest. No rewriting history.
7. **Store artifact** — upload .fpkg to R2 at `packages/:name/:version/:name-:version.fpkg`.
8. **Update D1** — insert version row with metadata.
9. **Async background**: enqueue a job to mirror to GitHub. The mirror job writes the same files to the GitHub repo via the git data API and pushes to main. Failures don't block the publish; we retry with exponential backoff.
10. **Return success** — JSON with the artifact URL and any warnings.

## Install flow (worker-side)

Three GET routes, all unauthenticated:

- `/registry/index.json` — query D1 for the latest version of every package, build the index, return JSON. Cache for 60 seconds at the edge.
- `/registry/packages/:name/meta.json` — query D1 for all versions of a package, build the meta, return JSON. Cache for 60 seconds.
- `/registry/packages/:name/:version/:filename.fpkg` — fetch from R2, return binary with appropriate Content-Type. Cache aggressively (immutable, versioned URLs).

The CLI and add-in just see different URLs serving the same shapes. No code changes beyond `REGISTRY_BASE`.

## Migration plan

When we decide to flip the switch:

1. **Backfill D1 + R2 from the GitHub repo.** One-time script reads the existing `index.json`, `meta.json` files, and `.fpkg` artifacts and populates D1 and R2.
2. **Deploy the worker** with the registry routes alongside the OAuth routes.
3. **Test installs** against `formulary.dev/registry/...` while leaving `raw.githubusercontent.com/...` working.
4. **Switch CLI and add-in defaults** to the new URL (one-line change in `commands/install.ts` and `taskpane.ts`). Old clients keep working via the GitHub URL.
5. **Switch publish flow.** CLI's `GitHubPRBackend` and add-in's `GitHubApiBackend` both get replaced with a `WorkerPublishBackend` that POSTs to `/registry/publish`. The old PR-based code stays in the tree as a fallback / for users without a network connection to formulary.dev.
6. **Enable the GitHub mirror** so the existing repo stays in sync.
7. **Monitor for a few weeks** — both URLs remain serviceable; we can roll back to GitHub-only if anything breaks.
8. **Eventually deprecate the raw.githubusercontent.com path** in client docs but never break it.

## Reference implementations

- **cloudflare/serverless-registry** — official-ish OCI/Docker container registry on Workers + R2. Closest existing pattern. Same auth model (Bearer token), same storage shape, same Worker routing.
- **crates.io** — the precedent for "started on GitHub, migrated to dedicated infra, kept GitHub mirror". Their migration RFC ([RFC 2789](https://rust-lang.github.io/rfcs/2789-sparse-index.html)) is worth reading for the rationale.
- **Verdaccio** — npm self-hosted registry. Different stack (Node.js, not Workers) but the API surface and concurrency model are well thought out.

## Open questions

1. **D1 vs KV.** D1 is SQLite-at-the-edge; KV is key-value. D1 is better for queries (search, ranking, stats) but more complex. KV is simpler but limits us to direct key lookups. Recommendation: KV initially, migrate to D1 if we need real queries.
2. **Mirror direction.** Worker is source of truth, GitHub is mirror? Or GitHub is source of truth, Worker is cache (the crates.io model)? Worker-as-truth is simpler operationally but requires good backups. GitHub-as-truth means publish-then-pull, which adds latency.
3. **Search and ranking.** Beyond the closed beta, browsing needs more than name + description. What signals do we use for ranking? Install counts (need analytics), explicit curation, recency, etc.
4. **Web UI on formulary.dev.** Out of scope for this doc but should be planned. crates.io and pypi.org both have extensive web UIs.
5. **Yank vs delete semantics.** Yanked versions still resolve for existing installs but aren't picked by new installs. How does the worker enforce this in `pickVersion`? Probably as a flag in the version metadata that `pickVersion` checks.
6. **Rate limiting.** Workers have built-in rate limiting; we should configure sensible limits per-IP for publish.

## Cost estimate (Cloudflare free tier)

- **Workers**: 100k requests/day free
- **R2**: 10 GB storage + 1M Class A operations/month + 10M Class B operations/month free
- **D1**: 5 GB storage + 5M reads/day + 100k writes/day free
- **KV**: 100k reads/day + 1k writes/day free
- **Workers KV / R2 / D1 secrets**: free, no limit

For closed beta and well past it, this is **$0/month**. Even at moderate growth (thousands of users, tens of thousands of installs/day) we'd stay in the free tier or pay <$10/month.

## Decision

**Defer implementation. Build the OAuth worker now.** When the OAuth worker is deployed and stable, add the registry routes incrementally. The architecture above is the target; the migration path is well-understood; we can move when there's a reason to.

The architecture choices here (R2 + KV/D1 + GitHub mirror) and the API shape (same routes as today) mean the migration is **additive** — no breaking changes to clients, no flag day. We can do it on our schedule.
