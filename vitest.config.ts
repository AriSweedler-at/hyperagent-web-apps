import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['web/**/*.test.ts', 'test/**/*.test.ts', 'infra/**/*.test.{js,ts}'],
    // test/dist/** reads the build output; vitest.dist.config.ts runs it after `npm run build`.
    // test/integration/** needs a PeerServer and Chromium; vitest.integration.config.ts runs it.
    exclude: ['**/node_modules/**', 'test/dist/**', 'test/integration/**'],
    coverage: {
      provider: 'v8',
      include: ['web/shared/lib/**/*.ts', 'web/shared/edge/**/*.ts', 'infra/games-proxy/worker.js'],
      exclude: ['**/*.test.ts'],
      // The shared pure library is held at 100%; the edges (effects behind injected fakes) at
      // 90% lines. Engine, domain, bots and *.algorithms.ts get theirs as they land
      // (docs/ARCHITECTURE.md "Testing pyramid").
      thresholds: {
        'web/shared/lib/**': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'web/shared/edge/**': { lines: 90, functions: 90, statements: 90 },
      },
    },
  },
});
