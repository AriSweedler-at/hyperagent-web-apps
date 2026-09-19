// The Score Counter's CSV export (docs/MIGRATION.md step 11), the text part of the legacy
// `exportGame()` (legacy/gin-rummy/index.html, pinned in test/fixtures/legacy/gin-ui.cjs): a
// header, one row per hand, a blank row and a TOTAL row, RFC 4180 quoting, CRLF line ends. The
// Blob, the download link and the toast stay with the screen (step 12). The hand's time column is
// `new Date(ts).toLocaleString()` in the legacy, so the formatter is injected and the golden test
// passes that same expression. test/parity/gin.scorer.test.ts is the oracle.
import { fmtDuration } from './format.ts';
import { KNOCK_LABELS, totalFor, type ScorerPlayer, type ScorerState } from './scores.ts';

export type CsvCell = string | number;
export type CsvRow = ReadonlyArray<CsvCell>;

/** A cell: quoted, with quotes doubled, when it holds a quote, a comma or a newline. */
export const csvEscape = (v: CsvCell | null | undefined): string => {
  const text = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** The rows of the export: header, hands, a blank row, totals. */
export const csvRows = (
  state: ScorerState,
  formatTime: (ts: number) => string,
): ReadonlyArray<CsvRow> => {
  const { players, rounds } = state;
  const header: CsvRow = [
    'Hand',
    'Time',
    'Duration',
    'Knocker',
    'Type',
    ...players.map((p) => `${p.name} Deadwood`),
    ...players.map((p) => `${p.name} Score`),
  ];
  const hands = rounds.map((r, i): CsvRow => {
    const knocker = players.find((p) => p.id === r.knockerId);
    const prevTs = i > 0 ? (rounds[i - 1]?.ts ?? state.startedAt) : state.startedAt;
    return [
      i + 1,
      formatTime(r.ts),
      fmtDuration(r.ts - prevTs),
      knocker?.name ?? '',
      KNOCK_LABELS[r.knockType],
      ...players.map((p) => r.deadwood[p.id] ?? ''),
      ...players.map((p) => r.scores[p.id] ?? 0),
    ];
  });
  const totals: CsvRow = [
    'TOTAL',
    '',
    '',
    '',
    '',
    ...players.map(() => ''),
    ...players.map((p) => totalFor(rounds, p.id)),
  ];
  return [header, ...hands, [], totals];
};

/** Rows to text: cells joined by commas, rows by CRLF, no trailing line end. */
export const csvText = (rows: ReadonlyArray<CsvRow>): string =>
  rows.map((row) => row.map(csvEscape).join(',')).join('\r\n');

export const exportCsv = (state: ScorerState, formatTime: (ts: number) => string): string =>
  csvText(csvRows(state, formatTime));

/** `gin-rummy-<names joined by -vs-, letters and digits only>-<YYYY-MM-DD-HH-MM>.csv` at `now`. */
export const csvFileName = (players: ReadonlyArray<ScorerPlayer>, now: number): string => {
  const stamp = new Date(now).toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const names = players.map((p) => p.name.replace(/[^a-z0-9]+/gi, '')).join('-vs-');
  return `gin-rummy-${names}-${stamp}.csv`;
};
