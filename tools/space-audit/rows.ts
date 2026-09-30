// The check table's rows (pure): one row per case x screen with an outcome per column, the text
// table stdout prints (shell-emulate's `summaryTable` shape, the four outcomes spelled out), and
// the diff against a baseline `report.json` (`--baseline`): the rows whose outcome changed in any
// column, so a per-game lane sees what its change moved and nothing else.
import { emulationName } from '../../web/shared/lib/devices.ts';
import { COLUMNS, OUTCOMES, type AuditCheck, type Outcome } from './judge.ts';
import type { AuditCard } from './sheet.ts';

/** One row: the case's name, the screen's id and the outcome per column. */
export type Row = Readonly<{
  case: string;
  screen: string;
  outcomes: Readonly<Record<string, Outcome>>;
}>;

const outcomeOf = (c: Pick<AuditCheck, 'pass'> & Partial<Pick<AuditCheck, 'outcome'>>): Outcome =>
  c.outcome ?? (c.pass ? 'ok' : 'FAIL');

const outcomesOf = (
  checks: ReadonlyArray<Pick<AuditCheck, 'name' | 'pass'> & Partial<Pick<AuditCheck, 'outcome'>>>,
): Readonly<Record<string, Outcome>> =>
  Object.fromEntries(checks.map((c) => [c.name, outcomeOf(c)] as const));

/** The rows of a run's cards, in the drive's order. */
export const rowsOf = (cards: ReadonlyArray<AuditCard>): ReadonlyArray<Row> =>
  cards.flatMap((c) =>
    c.screens.map((s) => ({
      case: emulationName(c.e),
      screen: s.screen.id,
      outcomes: outcomesOf(s.verdict.checks),
    })),
  );

const isOutcome = (v: unknown): v is Outcome =>
  typeof v === 'string' && (OUTCOMES as ReadonlyArray<string>).includes(v);
const isCheck = (
  v: unknown,
): v is Pick<AuditCheck, 'name' | 'pass'> & Partial<Pick<AuditCheck, 'outcome'>> =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as { name?: unknown }).name === 'string' &&
  typeof (v as { pass?: unknown }).pass === 'boolean' &&
  ((v as { outcome?: unknown }).outcome === undefined ||
    isOutcome((v as { outcome?: unknown }).outcome));

/**
 * The rows of a page's `report.json` (`{ cases: [{ case, screens: [{ screen: { id }, verdict:
 * { checks } }] }] }`), the first run's included: a check with no `outcome` reads its `pass`.
 * Anything else in the file is an error naming what is missing.
 */
export const rowsOfReport = (json: unknown): ReadonlyArray<Row> => {
  const cases = (json as { cases?: unknown } | null)?.cases;
  if (!Array.isArray(cases))
    throw new Error('the baseline has no `cases` list (a page report.json?)');
  return cases.flatMap((c: unknown, i) => {
    const name = (c as { case?: unknown }).case;
    const screens = (c as { screens?: unknown }).screens;
    if (typeof name !== 'string' || !Array.isArray(screens))
      throw new Error(`baseline case ${String(i)}: no \`case\` name or \`screens\` list`);
    return screens.map((s: unknown, j): Row => {
      const id = (s as { screen?: { id?: unknown } }).screen?.id;
      const checks = (s as { verdict?: { checks?: unknown } }).verdict?.checks;
      if (typeof id !== 'string' || !Array.isArray(checks) || !checks.every(isCheck))
        throw new Error(`baseline case ${name} screen ${String(j)}: no screen id or checks`);
      return { case: name, screen: id, outcomes: outcomesOf(checks) };
    });
  });
};

/** One column that moved: from the baseline's outcome (null where the row is new) to this run's. */
export type Change = Readonly<{ name: string; from: Outcome | null; to: Outcome }>;
export type ChangedRow = Readonly<{ case: string; screen: string; changes: ReadonlyArray<Change> }>;

const keyOf = (r: Row): string => `${r.case} ${r.screen}`;

/**
 * The rows of `after` whose outcome differs from `before`'s in any column, each with the columns
 * that moved; a row `before` never had lists every column from null. Rows `before` had and `after`
 * lacks are not listed: the run decides what is measured.
 */
export const changedRows = (
  before: ReadonlyArray<Row>,
  after: ReadonlyArray<Row>,
): ReadonlyArray<ChangedRow> => {
  const base = new Map(before.map((r) => [keyOf(r), r.outcomes] as const));
  return after
    .map((r): ChangedRow => {
      const old = base.get(keyOf(r)) ?? null;
      const changes = Object.entries(r.outcomes)
        .filter(([name, to]) => (old === null ? null : (old[name] ?? null)) !== to)
        .map(([name, to]): Change => ({
          name,
          from: old === null ? null : (old[name] ?? null),
          to,
        }));
      return { case: r.case, screen: r.screen, changes };
    })
    .filter((r) => r.changes.length > 0);
};

const pad = (s: string, n: number): string => s.padEnd(n);

/** The `check` table: one line per row, one column per check, the outcome in each, the tally last. */
export const checkTable = (rows: ReadonlyArray<Row>): string => {
  const names = rows.reduce<ReadonlyArray<string>>(
    (acc, r) => (acc.length === 0 ? Object.keys(r.outcomes) : acc),
    [],
  );
  const columns = names.length === 0 ? COLUMNS : names;
  const width = Math.max(4, ...rows.map((r) => keyOf(r).length));
  const head = [pad('case', width), ...columns.map((n) => pad(n, 8)), 'result'].join(' ');
  const passes = (r: Row): boolean => Object.values(r.outcomes).every((o) => o !== 'FAIL');
  const lines = rows.map((r) =>
    [
      pad(keyOf(r), width),
      ...columns.map((n) => pad(r.outcomes[n] ?? '-', 8)),
      passes(r) ? 'pass' : 'FAIL',
    ].join(' '),
  );
  const passed = rows.filter(passes).length;
  return [head, ...lines, `${String(passed)} of ${String(rows.length)} screens pass`].join('\n');
};

/** The diff table: one line per changed row, `column from→to` per moved column; a line saying so where nothing moved. */
export const changesTable = (changed: ReadonlyArray<ChangedRow>, total: number): string => {
  if (changed.length === 0)
    return `no verdict changed against the baseline (${String(total)} screens)`;
  const width = Math.max(4, ...changed.map((r) => `${r.case} ${r.screen}`.length));
  const lines = changed.map(
    (r) =>
      `${pad(`${r.case} ${r.screen}`, width)}  ${r.changes
        .map((c) => `${c.name} ${c.from ?? 'new'}→${c.to}`)
        .join(', ')}`,
  );
  return [
    ...lines,
    `${String(changed.length)} of ${String(total)} screens changed against the baseline`,
  ].join('\n');
};
