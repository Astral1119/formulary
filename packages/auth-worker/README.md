# Formulary Auth Worker

A small Cloudflare Worker that proxies the GitHub OAuth code-for-token exchange so the Excel add-in (and any other browser client) can authenticate without shipping the client secret.

Two routes:

- `GET /auth/github/start` — sets a signed state cookie, redirects to GitHub authorize
- `GET /auth/github/callback` — verifies state, exchanges code for token, returns an HTML page that calls `Office.context.ui.messageParent` with the token

Both routes are open. The worker holds `GITHUB_CLIENT_SECRET` and `COOKIE_SECRET` as Cloudflare secrets.

## Deployment

### Prerequisites

1. **Cloudflare account** — free tier is fine.
2. **`formulary.dev` on Cloudflare** — added as a zone with nameservers pointed at Cloudflare. (Alternative: deploy to a `*.workers.dev` subdomain — see "Without a custom domain" below.)
3. **GitHub OAuth app** — already created with client ID `Ov23licPLQb7ZRU8RuOp`. You'll need the **client secret** from the same settings page.
4. **Wrangler CLI** — bundled as a dev dep here, accessed via `pnpm`.

### Step 1: Update the GitHub OAuth app callback URL

Go to `https://github.com/settings/developers` → your "Formulary" OAuth app → **Authorization callback URL**, change it to:

```
https://formulary.dev/auth/github/callback
```

Save.

### Step 2: Authenticate Wrangler

From the repo root:

```bash
cd packages/auth-worker
pnpm exec wrangler login
```

This opens a browser to log into Cloudflare. Once authenticated, wrangler stores credentials in `~/.config/.wrangler/`.

### Step 3: Set the secrets

```bash
# The GitHub OAuth app's client secret (from github.com/settings/developers)
pnpm exec wrangler secret put GITHUB_CLIENT_SECRET
# Paste the secret when prompted.

# A random 32+ character string for HMAC-signing the state cookie.
# Generate one with: openssl rand -hex 32
pnpm exec wrangler secret put COOKIE_SECRET
# Paste the random string when prompted.
```

Wrangler will prompt for the worker name on first run — accept `formulary-auth`.

### Step 4: Enable the route on your custom domain

Edit `wrangler.toml` and uncomment the routes block:

```toml
[[routes]]
pattern = "formulary.dev/auth/github/*"
zone_name = "formulary.dev"
```

### Step 5: Deploy

```bash
pnpm exec wrangler deploy
```

Wrangler will deploy the worker and bind it to the route. First deploy may take a minute to propagate DNS.

### Step 6: Verify

```bash
# Should respond with a 302 to GitHub
curl -i https://formulary.dev/auth/github/start
```

You should see a `302 Found` with a `Location:` header pointing to `github.com/login/oauth/authorize?...`. If you get a 404 or fail to reach the worker, check that the route is configured and DNS is propagated (`dig formulary.dev`).

### Step 7: Test from the add-in

1. Build and run the Excel add-in dev server: `pnpm --filter @formulary/excel dev`
2. Sideload the manifest in Excel (already done from earlier work)
3. Open a workbook, open the add-in, initialize a project, add a function or two
4. Click **Publish**
5. The publish modal shows the preview. Click **Sign in & Publish**
6. An Office dialog opens, navigates to GitHub for consent
7. Authorize the Formulary OAuth app
8. Dialog closes, taskpane proceeds to publish

## Without a custom domain

If you don't want to (or can't yet) put `formulary.dev` on Cloudflare, deploy to a `*.workers.dev` subdomain:

1. Leave the routes block in `wrangler.toml` commented out.
2. Run `pnpm exec wrangler deploy`. Wrangler will give you a URL like `formulary-auth.<your-subdomain>.workers.dev`.
3. Update the GitHub OAuth app callback URL to that workers.dev URL + `/auth/github/callback`.
4. Update `AUTH_WORKER_BASE` in `packages/excel/src/publish/github.ts` to the workers.dev URL.
5. Rebuild the add-in.

This works for development or small deployments. For production, use the custom domain.

## Local development

```bash
pnpm exec wrangler dev
```

Runs the worker locally at `http://localhost:8787`. You'll need to:

1. Update the GitHub OAuth app callback URL to `http://localhost:8787/auth/github/callback` (only for testing — switch back to formulary.dev for production).
2. Set local secrets via `.dev.vars`:

   ```
   GITHUB_CLIENT_SECRET=<your secret>
   COOKIE_SECRET=<random hex>
   ```

3. Update `AUTH_WORKER_BASE` in the add-in to `http://localhost:8787/auth/github`.

## Operations

- **Logs:** `pnpm exec wrangler tail` — streams live request logs.
- **Rotate the client secret:** generate a new one in GitHub → `wrangler secret put GITHUB_CLIENT_SECRET` → done. No code change.
- **Rotate the cookie secret:** `wrangler secret put COOKIE_SECRET`. In-flight auth flows (sessions where start has run but callback hasn't) will fail and need to be restarted, but otherwise no impact.
- **Disable temporarily:** delete the route in the Cloudflare dashboard or comment out the routes block and redeploy. The worker stays deployed but receives no traffic.

## Troubleshooting

**404 on `/auth/github/start`:**
- Route not configured. Check `wrangler.toml` and that the worker was deployed with the route.
- DNS not propagated. `dig formulary.dev` should resolve to a Cloudflare IP.

**500 on `/auth/github/callback`:**
- Likely the secrets aren't set. Check `wrangler tail` for the actual error.
- `GITHUB_CLIENT_SECRET` mismatch with the GitHub OAuth app.

**State mismatch error:**
- The state cookie was lost between the redirect to GitHub and the callback. Check that:
  - The Cookie has `SameSite=Lax` (it does in our code)
  - The user didn't take longer than 10 minutes to authorize (the cookie TTL)
  - There's no aggressive ad-blocker stripping cookies

**Office dialog says "load failed":**
- The dialog can't reach the worker. Test in a regular browser first (`curl https://formulary.dev/auth/github/start`).
- HTTPS cert issues — Cloudflare provides a free cert automatically once the zone is set up. Check the zone status in the dashboard.

**Token is null after callback:**
- GitHub returned an error in the token exchange. Check `wrangler tail`. Common cause: callback URL in the OAuth app doesn't exactly match `https://formulary.dev/auth/github/callback`.
