// The dist tests (docs/ARCHITECTURE.md "Two origins" guards and the step-4 parity check) read the
// build output, so they run from `npm run test:dist` after `npm run build` and never from `npm test`:
// vitest.config.ts excludes test/dist/**, and this config includes only it. Each suite skips with a
// note when dist/ is absent.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/dist/**/*.test.ts'],
  },
});
