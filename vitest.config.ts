import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['web/**/*.test.ts', 'test/**/*.test.ts', 'infra/**/*.test.ts'],
    // test/dist/** reads the build output; vitest.dist.config.ts runs it after `npm run build`.
    // test/integration/** needs a PeerServer and Chromium; vitest.integration.config.ts runs it.
    exclude: ['**/node_modules/**', 'test/dist/**', 'test/integration/**'],
    coverage: {
      provider: 'v8',
      include: [
        'web/shared/lib/**/*.ts',
        'web/shared/edge/**/*.ts',
        'web/games/fidice/src/domain/**/*.ts',
        'web/games/fidice/src/bots/**/*.ts',
        'web/games/fidice/src/net/**/*.ts',
        'web/games/fidice/src/app/**/*.ts',
        'web/games/fidice/src/view/**/*.ts',
        'web/games/gin-rummy/src/engine/**/*.ts',
        'web/games/gin-rummy/src/protocol.ts',
        'web/games/gin-rummy/src/storage.ts',
        'web/games/gin-rummy/src/ui/**/*.ts',
        'web/games/gin-rummy/src/scorer/**/*.ts',
        'web/games/gin-rummy/src/net/**/*.ts',
        'web/games/gin-rummy/src/fx.ts',
        'infra/games-proxy/worker.ts',
      ],
      exclude: ['**/*.test.ts'],
      // The shared pure library is held at 100%; the edges (effects behind injected fakes) at
      // 90% lines. The fidice pure core (domain, bots and net/protocol, typed in docs/MIGRATION.md
      // step 8) is at 90% lines, functions and statements, exercised by the parity suites; the
      // domain's *.algorithms.ts at 100% lines; the fidice view (step 9) at 90%, exercised by the
      // per-screen render tests and the view oracle; its edges net/** (sessions over
      // transport.fake.ts) and app/** (the controller over fake effects, clock, DOM and session
      // stubs) at 90%. main.ts is the boot that constructs the real adapters and stays out. The gin
      // engine (step 10) is at 90% lines, functions and statements, exercised by the parity suites
      // and the replay, its melds.algorithms.ts at 100%. The gin protocol, storage and the pure
      // ui/ and scorer/ helpers (step 11) are at 90% each, exercised by the wire-corpus, storage
      // capture and string-golden suites under test/parity plus the table tests beside them. The
      // gin net/ sessions (step 12) are at 90%, exercised by the scenario tests beside them over
      // transport.fake.ts and clock.fake.ts and by the wire-corpus replay under test/parity. The
      // games.sweedler.com Worker (infra/games-proxy/worker.ts, TypeScript since step 15) is at 90%,
      // exercised by the table tests beside it over a stubbed global fetch. The rest get theirs as
      // they land (docs/ARCHITECTURE.md "Testing pyramid").
      thresholds: {
        'web/shared/lib/**': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'web/shared/edge/**': { lines: 90, functions: 90, statements: 90 },
        'web/games/fidice/src/domain/**': { lines: 90, functions: 90, statements: 90 },
        'web/games/fidice/src/bots/**': { lines: 90, functions: 90, statements: 90 },
        'web/games/fidice/src/net/protocol.ts': { lines: 90, functions: 90, statements: 90 },
        'web/games/fidice/src/net/**': { lines: 90, functions: 90, statements: 90 },
        'web/games/fidice/src/app/**': { lines: 90, functions: 90, statements: 90 },
        'web/games/fidice/src/view/**': { lines: 90, functions: 90, statements: 90 },
        'web/games/fidice/src/domain/*.algorithms.ts': {
          lines: 100,
          functions: 100,
          statements: 100,
        },
        'web/games/gin-rummy/src/engine/**': { lines: 90, functions: 90, statements: 90 },
        'web/games/gin-rummy/src/engine/*.algorithms.ts': {
          lines: 100,
          functions: 100,
          statements: 100,
        },
        'web/games/gin-rummy/src/protocol.ts': { lines: 90, functions: 90, statements: 90 },
        'web/games/gin-rummy/src/storage.ts': { lines: 90, functions: 90, statements: 90 },
        'web/games/gin-rummy/src/ui/**': { lines: 90, functions: 90, statements: 90 },
        'web/games/gin-rummy/src/scorer/**': { lines: 90, functions: 90, statements: 90 },
        'web/games/gin-rummy/src/net/**': { lines: 90, functions: 90, statements: 90 },
        'web/games/gin-rummy/src/fx.ts': { lines: 90, functions: 90, statements: 90 },
        'infra/games-proxy/worker.ts': { lines: 90, functions: 90, statements: 90 },
      },
    },
  },
});
