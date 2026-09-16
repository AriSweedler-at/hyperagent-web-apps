# hyperagent-web-apps

Single-file web apps built in Hyperagent, hosted on GitHub Pages.

| App | Live | Source |
|---|---|---|
| Gin Rummy | https://arisweedler-at.github.io/hyperagent-web-apps/games/gin-rummy/ | `games/gin-rummy/index.html` |
| Fidice (one-cup liar's dice) | https://arisweedler-at.github.io/hyperagent-web-apps/games/fidice/ | `games/fidice/index.html` |

Each app is a fully self-contained `index.html`. Runtime dependencies are loaded from public CDNs (PeerJS for online play; Google Fonts in Fidice). No build step — edit the file, push, Pages redeploys.

## Layout

```
games/gin-rummy/index.html   Gin Rummy
games/fidice/index.html      Fidice
shared/ice.js                ICE/TURN config loader shared by the games (window.HyperIce)
infra/turn-worker/           Cloudflare Worker that mints short-lived TURN credentials (option B below)
```

## Online play (TURN relay)

**Why.** Online play is peer-to-peer over WebRTC (PeerJS only brokers the handshake). When both devices sit behind NAT (a phone on cellular and a laptop on corporate Wi-Fi, say) a direct path cannot be punched and a TURN relay is mandatory. The free anonymous relays the games used to rely on are gone: PeerJS's default `*.turn.peerjs.com` hosts no longer resolve, and `openrelay.metered.ca` rejects the old shared credentials. If no relay is configured the games fall back to STUN-only (works on the same network or behind friendly NATs), and the host's wait screen shows a warning that a relay is not configured.

**Where to configure.** One constant: `ICE_CONFIG_URL` in `shared/ice.js`. For testing, append `?ice=<url>` to a game URL to override it without editing the file. The URL must return JSON, either a bare array of ICE servers or `{"iceServers":[...]}`, and must send CORS headers that allow the Pages origin (`https://arisweedler-at.github.io`). Results are cached for 10 minutes; fetch failures fall back to STUN-only.

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
   npx wrangler secret put TURN_KEY_ID
   npx wrangler secret put TURN_KEY_API_TOKEN
   npx wrangler deploy
   ```
3. Put the printed `*.workers.dev` URL into `ICE_CONFIG_URL`.

`wrangler.toml` has two vars: `ALLOWED_ORIGINS` (comma-separated origins allowed to fetch credentials; empty allows any) and `TTL_SECONDS` (credential lifetime, default 7200; a game session should fit inside it).

### Verify

- `curl <url>` should print JSON containing `turn:` and/or `turns:` entries.
- Open a game with `?ice=<url>` and host a room. The wait screen shows a relay hint only when no relay is configured.
- Connect a second device. A toast says "Connected via relay" or "Connected directly".
