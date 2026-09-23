import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['web/**/*.test.ts', 'test/**/*.test.ts', 'infra/**/*.test.ts', 'tools/**/*.test.ts'],
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
        'web/games/backgammon/src/engine/**/*.ts',
        'web/games/backgammon/src/protocol.ts',
        'web/games/backgammon/src/storage.ts',
        'web/games/backgammon/src/ui/**/*.ts',
        'web/games/backgammon/src/net/**/*.ts',
        'web/games/backgammon/src/fx.ts',
        'web/games/gin-rummy/src/protocol.ts',
        'web/games/gin-rummy/src/storage.ts',
        'web/games/gin-rummy/src/cardBack.ts',
        'web/games/gin-rummy/src/ui/**/*.ts',
        'web/games/gin-rummy/src/stories/catalogue.ts',
        'web/games/gin-rummy/src/scorer/**/*.ts',
        'web/games/gin-rummy/src/net/**/*.ts',
        'web/games/gin-rummy/src/fx.ts',
        'infra/games-proxy/worker.ts',
      ],
      exclude: ['**/*.test.ts'],
      // Ratcheted from the measured numbers in docs/MIGRATION.md step 15 (the unit suites are
      // seeded, so the figures are deterministic): lines, functions and statements sit 5 points
      // under what was measured wherever that beat the former 90% floor by 8 or more, branches
      // 3 points under (every group measured above 75%), and nothing went down. The shared pure
      // library and both *.algorithms.ts stay at 100% lines, functions and statements
      // (docs/ARCHITECTURE.md "*.algorithms.ts"). Who exercises what: the fidice pure core (domain,
      // bots, net/protocol) the parity suites; the fidice view the per-screen render tests and the
      // view oracle; its net/** (sessions over transport.fake.ts) and app/** (the controller over
      // fake effects, clock, DOM and session stubs) the tests beside them, main.ts staying out as
      // the boot that constructs the real adapters; the gin engine the parity suites and the
      // replay; the gin protocol, storage and pure ui/ and scorer/ helpers the wire-corpus,
      // storage-capture and string-golden suites under test/parity plus the table tests beside
      // them; the gin net/ sessions the scenario tests beside them and the wire-corpus replay;
      // the games.sweedler.com Worker (infra/games-proxy/worker.ts) its table tests over a stubbed
      // global fetch. Measured at the ratchet (lines/functions/statements/branches):
      // shared/lib 100/100/100/100, shared/edge 99.5/99.1/98.9/93.4, fidice domain
      // 100/100/99.1/92.6, bots 98.9/97.9/98.4/89.9, net/protocol 100/100/100/96.7, net
      // 95.9/93.2/92.2/84.4, app 99.7/98.5/99.1/97.2, view 100/100/99.3/94.3, domain algorithms
      // 100/100/100/87.5; gin engine 99.8/99.3/98.7/95.8, engine algorithms 100/100/100/100,
      // protocol 100/100/100/100, storage 100/100/100/100, ui 99.8/99.5/99.1/93.7, scorer
      // 100/100/97.9/88.5, net 100/100/99.2/96.2, fx 100/100/100/100; games-proxy
      // 100/100/100/96.7 (docs/ARCHITECTURE.md "Testing pyramid").
      thresholds: {
        'web/shared/lib/**': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'web/shared/edge/**': { lines: 94, functions: 94, statements: 93, branches: 90 },
        'web/games/fidice/src/domain/**': {
          lines: 95,
          functions: 95,
          statements: 94,
          branches: 89,
        },
        'web/games/fidice/src/bots/**': { lines: 93, functions: 92, statements: 93, branches: 86 },
        'web/games/fidice/src/net/protocol.ts': {
          lines: 95,
          functions: 95,
          statements: 95,
          branches: 93,
        },
        'web/games/fidice/src/net/**': { lines: 90, functions: 90, statements: 90, branches: 81 },
        'web/games/fidice/src/app/**': { lines: 94, functions: 93, statements: 94, branches: 94 },
        'web/games/fidice/src/view/**': { lines: 95, functions: 95, statements: 94, branches: 91 },
        'web/games/fidice/src/domain/*.algorithms.ts': {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 84,
        },
        'web/games/gin-rummy/src/engine/**': {
          lines: 94,
          functions: 94,
          statements: 93,
          branches: 92,
        },
        'web/games/gin-rummy/src/engine/*.algorithms.ts': {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 97,
        },
        // The backgammon engine (web/games/backgammon/src/engine): the table, scenario and seeded
        // replay tests beside it; the same targets as gin's engine, 100% lines for any algorithms file.
        'web/games/backgammon/src/engine/**': {
          lines: 94,
          functions: 94,
          statements: 93,
          branches: 92,
        },
        'web/games/backgammon/src/engine/*.algorithms.ts': {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 92,
        },
        // The rest of the backgammon page (docs/design/backgammon-board.md §6), at measured minus
        // 5/5/5/3 like gin's rows: the wire goldens and decoder tests (protocol), the Map-backed
        // store tests (storage), the reducer, builder, painter and page-fake suites (ui/**), the
        // session scenarios over transport.fake.ts (net/**) and the cue table (fx). Measured
        // (lines/functions/statements/branches): protocol 100/100/100/100, storage
        // 100/100/100/100, ui 99.6/100/98.7/91.6, net 100/100/98.9/94.4, fx 100/100/100/100.
        'web/games/backgammon/src/protocol.ts': {
          lines: 95,
          functions: 95,
          statements: 95,
          branches: 97,
        },
        'web/games/backgammon/src/storage.ts': {
          lines: 95,
          functions: 95,
          statements: 95,
          branches: 97,
        },
        'web/games/backgammon/src/ui/**': {
          lines: 94,
          functions: 95,
          statements: 93,
          branches: 88,
        },
        'web/games/backgammon/src/net/**': {
          lines: 95,
          functions: 95,
          statements: 93,
          branches: 91,
        },
        'web/games/backgammon/src/fx.ts': {
          lines: 95,
          functions: 95,
          statements: 95,
          branches: 97,
        },
        'web/games/gin-rummy/src/protocol.ts': {
          lines: 95,
          functions: 95,
          statements: 95,
          branches: 97,
        },
        'web/games/gin-rummy/src/storage.ts': {
          lines: 95,
          functions: 95,
          statements: 95,
          branches: 97,
        },
        'web/games/gin-rummy/src/cardBack.ts': {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        'web/games/gin-rummy/src/ui/**': { lines: 94, functions: 94, statements: 94, branches: 90 },
        // The stories catalogue (docs/design/gin-draw-ghost-slot.md §7): pure builders its own test
        // runs in full; stories/boot.ts is the page that paints them and stays out, like main.ts.
        'web/games/gin-rummy/src/stories/catalogue.ts': {
          lines: 90,
          functions: 90,
          statements: 90,
          branches: 90,
        },
        'web/games/gin-rummy/src/scorer/**': {
          lines: 95,
          functions: 95,
          statements: 92,
          branches: 85,
        },
        'web/games/gin-rummy/src/net/**': {
          lines: 95,
          functions: 95,
          statements: 94,
          branches: 93,
        },
        'web/games/gin-rummy/src/fx.ts': { lines: 95, functions: 95, statements: 95, branches: 97 },
        'infra/games-proxy/worker.ts': { lines: 95, functions: 95, statements: 95, branches: 93 },
      },
    },
  },
});
