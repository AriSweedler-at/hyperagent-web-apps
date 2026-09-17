/* shared/ice.js — ICE (STUN/TURN) configuration shared by every game in this repo.
 *
 * Why this exists: two devices on different networks (phone on cellular, laptop on
 * corporate Wi-Fi / Zero Trust) are both behind symmetric NAT. STUN alone cannot
 * connect them; a TURN relay is required. Every free anonymous relay the apps used
 * to lean on has been shut down (PeerJS's turn.peerjs.com hosts no longer resolve,
 * Metered's open relay now requires an account), so relay credentials must come
 * from a provider you own. This module fetches them at connect time.
 *
 * ── Setup (one line) ──────────────────────────────────────────────────────────
 * Set ICE_CONFIG_URL below to an HTTPS endpoint that returns ICE servers as either
 *   • a bare JSON array:           [ { urls, username, credential }, ... ]   (Metered)
 *   • or an object: { "iceServers": [ ... ] }                                 (Cloudflare Worker in infra/turn-worker)
 * See README.md → "Online play (TURN relay)" for both providers' steps.
 *
 * For testing without editing this file, append ?ice=<url> to a game's URL.
 *
 * Public API (window.HyperIce):
 *   load(opts?) → Promise<{ iceServers, source: 'remote'|'fallback', hasTurn, error }>
 *   peerConfig(result) → RTCConfiguration suitable for PeerJS `config`
 *   describe(pc) → Promise<{ path: 'direct'|'relay'|'unknown', local, remote }>
 *   watch(pc, cb) → cb({ ice, conn }) on every ICE / connection state change
 */
(function () {
  'use strict';

  var ICE_CONFIG_URL = 'https://turn.sweedler.com';

  // STUN-only fallback. Lets same-network / friendly-NAT peers connect when no relay
  // is configured or the credential endpoint is unreachable. Not enough for
  // cellular ↔ corporate; `hasTurn` tells the app so it can warn the player.
  var FALLBACK_ICE = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ];

  var FETCH_TIMEOUT_MS = 4000;
  var CACHE_TTL_MS = 10 * 60 * 1000; // reconnects within 10 min reuse the same credentials
  var cache = null; // { at, result }

  function configUrl() {
    try {
      var q = new URLSearchParams(location.search).get('ice');
      if (q && /^https?:\/\//.test(q)) return q;
    } catch (e) { /* ignore */ }
    return ICE_CONFIG_URL;
  }

  function isTurn(server) {
    var urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.some(function (u) { return typeof u === 'string' && /^turns?:/i.test(u); });
  }

  function normalize(body) {
    var list = Array.isArray(body) ? body : (body && Array.isArray(body.iceServers) ? body.iceServers : null);
    if (!list) throw new Error('ICE endpoint returned neither an array nor {iceServers}');
    var servers = list.filter(function (s) { return s && s.urls && (typeof s.urls === 'string' || Array.isArray(s.urls)); });
    if (!servers.length) throw new Error('ICE endpoint returned no usable servers');
    return servers;
  }

  function fetchWithTimeout(url, ms) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms);
    return fetch(url, { signal: ctrl ? ctrl.signal : undefined, cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('ICE endpoint HTTP ' + r.status);
        return r.json();
      })
      .finally(function () { clearTimeout(timer); });
  }

  function fallback(error) {
    return { iceServers: FALLBACK_ICE.slice(), source: 'fallback', hasTurn: false, error: error || null };
  }

  /** Resolve the ICE server list. Never rejects: on any failure resolves to the STUN fallback. */
  function load(opts) {
    opts = opts || {};
    var url = opts.url || configUrl();
    if (!url) return Promise.resolve(fallback('No ICE_CONFIG_URL configured (shared/ice.js)'));
    var now = Date.now();
    if (!opts.force && cache && cache.url === url && now - cache.at < CACHE_TTL_MS) return Promise.resolve(cache.result);
    return fetchWithTimeout(url, opts.timeoutMs || FETCH_TIMEOUT_MS)
      .then(function (body) {
        var servers = normalize(body);
        var result = { iceServers: servers, source: 'remote', hasTurn: servers.some(isTurn), error: null };
        cache = { url: url, at: Date.now(), result: result };
        return result;
      })
      .catch(function (e) {
        return fallback((e && e.name === 'AbortError') ? 'ICE endpoint timed out' : String(e && e.message || e));
      });
  }

  /** RTCConfiguration for PeerJS's `config` option. */
  function peerConfig(result) {
    return { iceServers: (result && result.iceServers) || FALLBACK_ICE.slice(), sdpSemantics: 'unified-plan' };
  }

  /** Inspect the selected candidate pair: was the connection direct or relayed through TURN? */
  function describe(pc) {
    if (!pc || typeof pc.getStats !== 'function') return Promise.resolve({ path: 'unknown', local: null, remote: null });
    return pc.getStats().then(function (stats) {
      var pair = null, byId = {};
      stats.forEach(function (s) { byId[s.id] = s; });
      stats.forEach(function (s) {
        if (s.type === 'transport' && s.selectedCandidatePairId && byId[s.selectedCandidatePairId]) pair = byId[s.selectedCandidatePairId];
      });
      if (!pair) stats.forEach(function (s) { if (s.type === 'candidate-pair' && (s.selected || s.nominated) && s.state === 'succeeded') pair = pair || s; });
      if (!pair) return { path: 'unknown', local: null, remote: null };
      var local = byId[pair.localCandidateId], remote = byId[pair.remoteCandidateId];
      var lt = local && local.candidateType, rt = remote && remote.candidateType;
      var path = (lt === 'relay' || rt === 'relay') ? 'relay' : (lt && rt ? 'direct' : 'unknown');
      return { path: path, local: lt || null, remote: rt || null };
    }).catch(function () { return { path: 'unknown', local: null, remote: null }; });
  }

  /** Report ICE / connection state transitions so the UI can explain stalls. */
  function watch(pc, cb) {
    if (!pc || typeof cb !== 'function') return function () {};
    var emit = function () { cb({ ice: pc.iceConnectionState, conn: pc.connectionState }); };
    pc.addEventListener('iceconnectionstatechange', emit);
    pc.addEventListener('connectionstatechange', emit);
    return function () {
      pc.removeEventListener('iceconnectionstatechange', emit);
      pc.removeEventListener('connectionstatechange', emit);
    };
  }

  window.HyperIce = { load: load, peerConfig: peerConfig, describe: describe, watch: watch, FALLBACK_ICE: FALLBACK_ICE };
})();
