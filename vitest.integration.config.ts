// The transport integration test (test/integration/) starts a PeerServer, a Vite dev server and
// Chromium, so it runs from `npm run test:integration` (CI job `check`, after the unit tests) and
// never from `npm test`, whose config excludes the directory. It skips itself where loopback
// WebRTC is unavailable (see the test header).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/integration/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // One browser at a time; the suite holds ports and a Chromium process.
    fileParallelism: false,
  },
});
