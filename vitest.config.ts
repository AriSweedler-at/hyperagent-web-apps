import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['web/**/*.test.ts', 'test/**/*.test.ts', 'infra/**/*.test.{js,ts}'],
    coverage: {
      provider: 'v8',
      include: ['web/shared/lib/**/*.ts', 'infra/games-proxy/worker.js'],
      exclude: ['**/*.test.ts'],
      // Thresholds gate only the shared pure library for now; engine, domain, bots and
      // *.algorithms.ts get theirs as they land (docs/ARCHITECTURE.md "Testing pyramid").
      thresholds: {
        'web/shared/lib/**': { lines: 100, functions: 100, branches: 100, statements: 100 },
      },
    },
  },
});
