// `fmtDuration` (docs/MIGRATION.md step 11), ported from the legacy multiplayer UI
// (legacy/gin-rummy/index.html, pinned in test/fixtures/legacy/gin-ui.cjs). The table's status
// strings (ui/cues.ts) and the CSV export (scorer/csv.ts) both format durations with it; it lives
// here so the scorer never imports ui/ (docs/ARCHITECTURE.md "Module boundaries"), and ui/cues.ts
// re-exports it. test/parity/gin.ui.test.ts is the oracle.

/** `1h 2m`, `3m 4s` or `5s`; negative durations read as 0. */
export const fmtDuration = (ms: number): string => {
  const t = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h !== 0
    ? `${String(h)}h ${String(m)}m`
    : m !== 0
      ? `${String(m)}m ${String(s)}s`
      : `${String(s)}s`;
};
