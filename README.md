# hyperagent-web-apps

Single-file web apps built in Hyperagent, hosted on GitHub Pages.

| App                          | Live                                                                  | Source                        |
| ---------------------------- | --------------------------------------------------------------------- | ----------------------------- |
| Gin Rummy                    | https://arisweedler-at.github.io/hyperagent-web-apps/games/gin-rummy/ | `legacy/gin-rummy/index.html` |
| Fidice (one-cup liar's dice) | https://arisweedler-at.github.io/hyperagent-web-apps/games/fidice/    | `legacy/fidice/index.html`    |

The same site is served at **https://games.sweedler.com** through the Cloudflare Worker in `infra/games-proxy/`: `games.sweedler.com/gin-rummy/` and `games.sweedler.com/fidice/` are the short URLs, `/games/<name>/` redirects to them, and `/shared/…` maps to the site's `shared/` directory (today `shared/ice.js`, later Vite's `shared/assets/`).

Each app is still a fully self-contained `index.html`, frozen under `legacy/` and served byte-for-byte. Runtime dependencies are loaded from public CDNs (PeerJS for online play; Google Fonts in Fidice). The site is built by Vite into `dist/` (`npm run build`: `web/` is the Vite root, and the `legacyPassthrough` plugin in `vite.config.ts` copies each page listed in `LEGACY_PAGES` from `legacy/` over the output) and published to GitHub Pages by the `deploy` job in `.github/workflows/ci.yml` on every push to `main` whose `check` and `e2e` jobs pass; nothing generated is committed (see "Deploying"). The pages are being migrated to strict TypeScript under `web/`; `docs/ARCHITECTURE.md` is the target and `docs/MIGRATION.md` the ordered plan.

## Development

Node 22 (`.nvmrc`). TypeScript, ESLint (typescript-eslint strict, eslint-plugin-functional, import-x boundaries), Prettier and vitest, all pinned exactly in `package.json`.

```
npm ci                 # install; the `prepare` script also installs the git hooks
npm run check          # typecheck + lint + unit tests + build + dist guards: the gate CI and the pre-push hook run
npm test               # vitest once (`npm run test:watch` keeps it running; `-- --coverage` for the report)
npm run build          # vite build -> dist/ (legacy pages copied byte-for-byte by the passthrough plugin)
npm run test:dist      # guards on dist/: relative asset URLs, paths on both origins, parity with legacy/ and web/
npm run hooks          # git config core.hooksPath .githooks (re-run if hooksPath was changed)
npm run hooks:verify   # confirm the hook wiring
npm run format         # prettier --write on everything it checks
npm run fixtures:legacy  # re-cut test/fixtures/legacy/*.cjs from the pages and re-pin MANIFEST.json
npm run test:e2e       # build, then Playwright: every spec on both emulated origins against dist/ (starts its own servers)
npm run serve          # GitHub Pages emulation: dist/ at http://127.0.0.1:4173/hyperagent-web-apps/
npm run preview        # build, then serve
npm run proxy:dev      # games.sweedler.com emulation: the real Worker at http://127.0.0.1:8787/ over :4173
```

Git hooks live in `.githooks/`: `pre-commit` chains to the owner's template hook in `.git/hooks/pre-commit` (big-file and trailing-whitespace prompts) and `pre-push` runs `npm run check`. The legacy pages under `legacy/` are byte-frozen (`test/dist/dist-parity.test.ts` and the fixture manifest pin them); lint and Prettier ignore them, and Prettier also leaves `web/index.html` alone because dist parity compares against it verbatim.

### Browser tests

`npm run test:e2e` (first time: `npx playwright install chromium`) builds `dist/` and runs the specs in `e2e/` against it on two Playwright projects: `pages` (`dist/` under `/hyperagent-web-apps/` on `tools/serve-dist.ts`, like GitHub Pages) and `proxy` (short URLs on `tools/proxy-dev.ts`, which runs the real `infra/games-proxy/worker.js` against the pages origin, like games.sweedler.com). The config starts both servers and a local PeerServer (`peer` package, :9000); the online specs open a host and a guest context that meet there through the pages' `?peer=host:port` hook and take a STUN-only ICE list from `e2e/fixtures/e2e-ice.json` through `?ice=`, so no real network is needed. PeerJS and Google Fonts are answered from local copies. Each context gets a seeded `Math.random` (`e2e/browser/seed-random.js`), so deals and dice repeat. `E2E_BROKER=cloud npm run test:e2e -- --grep @online` plays the online specs through 0.peerjs.com instead; CI runs that as the advisory `broker` job. The HTML report lands in `playwright-report/` (`npx playwright show-report`).

Two contexts in one browser connect over the machine's own addresses, so the online specs need local UDP loopback to those addresses. A Cloudflare WARP or similar tunnel that drops packets sent to its own interface address breaks that (the hermetic specs then time out at the data channel); CI runners and plain networks are fine.

### Legacy oracles

`test/fixtures/legacy/` holds the gin engine (`gin-engine.cjs`) and the fidice core (`fidice-core.cjs`) cut verbatim out of the legacy pages by `tools/legacy/extract-*.ts` and pinned by sha256 in `MANIFEST.json`. `manifest.test.ts` re-runs the extractors against the pages on every test run, so an edit inside either range fails the suite until `npm run fixtures:legacy` regenerates the fixtures (and the PR says why the oracle moved). `test/parity/*.legacy.test.ts` characterize the cores over seeded inputs (`web/shared/lib/rng.ts`, mulberry32) rather than stored goldens; when a port lands it joins the same `describe.each` as a second leg and must agree. Test hooks on the pages: gin exposes `window.__gin`; fidice exposes `window.__fidice = { controller }` and the host session takes `globalThis.__rng` as its rng when a test installs one before boot.

`package-lock.json` is written behind Airtable's Socket Firewall registry and is committed exactly as
npm produces it. CI installs through `.github/actions/npm-ci`, which points the runner's copy of the
lockfile at the public registry, scans the install with Socket Firewall Free, and restores the file.

## Deploying

GitHub Pages serves `dist/`, built and published by the `deploy` job in `.github/workflows/ci.yml`: on a push to `main`, after `check` (which builds `dist/`, runs the dist guards and uploads it) and `e2e` pass, the job downloads that artifact and runs `actions/configure-pages`, `actions/upload-pages-artifact` and `actions/deploy-pages`, then prints both served URLs in its summary. Nothing generated is committed.

One-time console step, done right after the first merge with a green workflow: **Settings > Pages > Build and deployment > Source: GitHub Actions**. Until the source is flipped the `deploy` job fails at `deploy-pages` and Pages keeps serving the branch as before; nothing else changes. The job's `github-pages` environment is created by that first successful deploy.

Roll back by switching the source back to **Deploy from a branch** (`main`, `/ (root)`) and reverting the merge that introduced this step on `main`, which brings the root `index.html`, `games/` and `shared/` back. For a bad later deploy no flip is needed: revert the offending commit on `main` and the same job redeploys the previous `dist/`.

## Layout

```
web/index.html               landing page, the first Vite entry (no scripts); dist/index.html is byte-identical
web/public/.nojekyll         copied to dist/ so Pages serves dotfiles and folders untouched
web/shared/lib/              shared pure TypeScript (result, rng); games land under web/games/<name>/
legacy/gin-rummy/index.html  Gin Rummy, verbatim; copied to dist/games/gin-rummy/ by the passthrough plugin
legacy/fidice/index.html     Fidice, verbatim; copied to dist/games/fidice/
legacy/shared/ice.js         ICE/TURN config loader shared by the games (window.HyperIce); copied to dist/shared/
vite.config.ts               Vite root web/, base './', input = every web/**/index.html, legacyPassthrough
dist/                        build output (gitignored): what GitHub Pages serves
infra/turn-worker/           Cloudflare Worker that mints short-lived TURN credentials (option B below)
infra/games-proxy/           Cloudflare Worker serving the site at games.sweedler.com
```

## Online play (TURN relay)

**Why.** Online play is peer-to-peer over WebRTC (PeerJS only brokers the handshake). When both devices sit behind NAT (a phone on cellular and a laptop on corporate Wi-Fi, say) a direct path cannot be punched and a TURN relay is mandatory. The free anonymous relays the games used to rely on are gone: PeerJS's default `*.turn.peerjs.com` hosts no longer resolve, and `openrelay.metered.ca` rejects the old shared credentials. If no relay is configured the games fall back to STUN-only (works on the same network or behind friendly NATs), and the host's wait screen shows a warning that a relay is not configured.

**Where to configure.** One constant: `ICE_CONFIG_URL` in `legacy/shared/ice.js`. This repo's copy points at `https://turn.sweedler.com`, the Cloudflare Worker from option B deployed on the sweedler.com zone. For testing, append `?ice=<url>` to a game URL to override it without editing the file. The URL must return JSON, either a bare array of ICE servers or `{"iceServers":[...]}`, and must send CORS headers that allow the Pages origin (`https://arisweedler-at.github.io`). Results are cached for 10 minutes; fetch failures fall back to STUN-only.

### Option A: Metered.ca (fastest, no server)

1. Create a free account at https://www.metered.ca/, create an app, and copy its API key.
2. Set `ICE_CONFIG_URL` to `https://<app>.metered.live/api/v1/turn/credentials?apiKey=<key>`.

The key is visible in page source. That is acceptable for a free-tier hobby quota (0.5 GB/month at the time of writing; check metered.ca pricing), which is ample for text-only game traffic.

### Option B: Cloudflare Realtime TURN (recommended long-term)

1000 GB/month free, and the key stays secret because the Worker in `infra/turn-worker/` mints short-lived credentials on demand.

1. dash.cloudflare.com -> Realtime -> TURN -> Create key. Copy the Key ID and API token (the token is shown once).
2. Deploy the Worker:
   ```
   cd infra/turn-worker
   npx wrangler login
   npx wrangler deploy
   npx wrangler secret put TURN_KEY_API_TOKEN
   ```
   Deploy before the secret put so the Worker exists. Put the key's ID in `TURN_KEY_ID` under `[vars]` in `wrangler.toml` (it is not secret).
3. Put the printed `*.workers.dev` URL into `ICE_CONFIG_URL`.

`wrangler.toml` has two vars: `ALLOWED_ORIGINS` (comma-separated browser origins allowed to fetch credentials; empty allows any; requests with no Origin header such as curl always pass) and `TTL_SECONDS` (credential lifetime, default 7200; a game session should fit inside it). To test with `?ice=` from a local dev server, add its origin (for example `http://localhost:8765`) to `ALLOWED_ORIGINS` or leave the list empty.

### Verify

- `curl <url>` should print JSON containing `turn:` and/or `turns:` entries.
- Open a game with `?ice=<url>` and host a room. The wait screen shows a relay hint only when no relay is configured.
- Connect a second device. A toast says "Connected via relay" or "Connected directly".
