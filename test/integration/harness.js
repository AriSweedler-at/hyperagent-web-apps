// Page side of test/integration/transport.integration.test.ts. Served by a Vite dev server so the
// TypeScript modules load untouched; the test calls `__transport.run(...)` through page.evaluate
// and reads back the contract log. Plain JS with `globalThis` only: this file is outside every
// tsconfig project and is linted by the JS config.
import { EXPECTED_CONTRACT_LOG, runContract } from '../../web/shared/edge/transport.contract.ts';
import { realTransport } from '../../web/shared/edge/transport.ts';

/**
 * @param {{ hostId: string, search: string, timeoutMs: number }} args
 * @returns {Promise<{ log: string[], timedOut: boolean, expected: readonly string[], error: string | null }>}
 */
const run = async ({ hostId, search, timeoutMs }) => {
  /** @type {string[]} */
  const log = [];
  const ice = {
    iceServers: [{ urls: 'stun:127.0.0.1:3478' }],
    source: 'remote',
    hasTurn: false,
    error: null,
  };
  const host = realTransport({ ice, search });
  const guest = realTransport({ ice, search });
  const timeout = new Promise((resolve) => {
    globalThis.setTimeout(() => resolve('timeout'), timeoutMs);
  });
  try {
    const outcome = await Promise.race([
      runContract(host, guest, hostId, { onStep: (entry) => log.push(entry) }),
      timeout,
    ]);
    return { log, timedOut: outcome === 'timeout', expected: EXPECTED_CONTRACT_LOG, error: null };
  } catch (e) {
    return {
      log,
      timedOut: false,
      expected: EXPECTED_CONTRACT_LOG,
      error: e instanceof Error ? e.message : String(e),
    };
  }
};

globalThis.__transport = { run };
