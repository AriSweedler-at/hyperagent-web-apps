/**
 * Cloudflare Worker: mints short-lived TURN credentials from Cloudflare Realtime TURN
 * and hands them to the games as { iceServers: [...] }.
 *
 * The TURN key API token must never reach the browser, so this tiny server does the
 * one authenticated call. Deploy with `wrangler deploy` from this directory after:
 *   wrangler secret put TURN_KEY_ID
 *   wrangler secret put TURN_KEY_API_TOKEN
 * Optionally restrict callers: set ALLOWED_ORIGINS in wrangler.toml (comma-separated).
 */
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const originOk = allowed.length === 0 || allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': allowed.length === 0 ? '*' : (originOk ? origin : 'null'),
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    const json = (status, body) => new Response(JSON.stringify(body), {
      status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return json(405, { error: 'GET only' });
    if (!originOk) return json(403, { error: 'origin not allowed' });
    if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return json(500, { error: 'worker missing TURN_KEY_ID / TURN_KEY_API_TOKEN secrets' });

    const ttl = Math.min(Math.max(parseInt(env.TTL_SECONDS || '7200', 10) || 7200, 300), 86400);
    const upstream = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl }),
      },
    );
    if (!upstream.ok) return json(502, { error: 'Cloudflare TURN credential request failed', status: upstream.status });
    const body = await upstream.json();
    if (!body || !Array.isArray(body.iceServers)) return json(502, { error: 'unexpected upstream response' });
    return json(200, { iceServers: body.iceServers, ttl });
  },
};
