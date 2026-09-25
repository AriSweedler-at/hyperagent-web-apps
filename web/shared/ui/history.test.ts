// The shared history panel over a FAKE page (web/shared/edge/page.fake.ts; the markup is kept as
// a string, so the rows are asserted as the markup a paint wrote): rows equal events, the summary
// and detail text from the copy, the key that survives a repaint, the new row appended under a
// named stream (an open row survives the next event), an unknown kind as the summary alone, the
// empty note, and the scroll to the newest row (docs/design/briscola-sound-history.md §6, PR S3).
import { describe, expect, test } from 'vitest';

import { setAttr } from '../edge/dom.ts';
import { fakeEl, fakePage, type FakePage } from '../edge/page.fake.ts';
import type { EventCopy, GameEvent } from '../lib/events.ts';
import { HISTORY_IDS } from './ids.ts';
import {
  historyHtml,
  historyKey,
  historyRowHtml,
  paintHistory,
  scrollHistoryToEnd,
} from './history.ts';

/** A stream in the words of a made-up game: nothing here is a shared vocabulary. */
type Ev = GameEvent<'deal' | 'trick' | 'result', Readonly<{ points: number }>>;
type Ctx = Readonly<{ names: ReadonlyArray<string> }>;

const ev = (id: number, kind: Ev['kind'], seat: number | null, points = 0): Ev => ({
  id,
  kind,
  seat,
  at: 1000 + id,
  data: { points },
});

const CTX: Ctx = { names: ['Ari', 'Jeff <b>'] };

/** The copy a game supplies: the actor, one summary per kind, rows for a trick alone. */
const COPY: EventCopy<Ev, Ctx> = {
  who: (e, ctx) => (e.seat === null ? null : (ctx.names[e.seat] ?? '?')),
  summary: (e) =>
    e.kind === 'trick'
      ? `took the trick · ${String(e.data.points)} points`
      : e.kind === 'deal'
        ? 'New deal'
        : 'Game over',
  detail: (e) => (e.kind === 'trick' ? [['Points', String(e.data.points)]] : []),
  value: (e) => (e.kind === 'trick' && e.data.points >= 11 ? 'big' : null),
  empty: 'Nothing has happened yet.',
};

const STREAM: ReadonlyArray<Ev> = [
  ev(0, 'deal', null),
  ev(1, 'trick', 1, 14),
  ev(2, 'trick', 0, 3),
];

const rowsIn = (markup: string): ReadonlyArray<string> =>
  [...markup.matchAll(/<details[^>]*>.*?<\/details>/g)].map((m) => m[0]);

describe('historyRowHtml', () => {
  test('a trick: kind, id, seat and value on the details, the who span, the summary, the detail pairs', () => {
    const row = historyRowHtml(ev(1, 'trick', 1, 14), COPY, CTX).markup;
    expect(row).toBe(
      '<details class="history-row" data-kind="trick" data-id="1" data-seat="1" data-value="big">' +
        '<summary><span class="who">Jeff &lt;b&gt;</span> took the trick · 14 points</summary>' +
        '<dl class="history-detail"><dt>Points</dt><dd>14</dd></dl></details>',
    );
  });

  test('a table event: no seat, no who, no value; a kind the copy gives no rows for is the summary alone', () => {
    const row = historyRowHtml(ev(0, 'deal', null), COPY, CTX).markup;
    expect(row).toBe(
      '<details class="history-row" data-kind="deal" data-id="0"><summary>New deal</summary></details>',
    );
    expect(row).not.toContain('history-detail');
  });

  test('a copy without who or value writes neither the span nor the attribute', () => {
    const bare: EventCopy<Ev, Ctx> = { summary: () => 'line', detail: () => [] };
    expect(historyRowHtml(ev(2, 'trick', 0, 3), bare, CTX).markup).toBe(
      '<details class="history-row" data-kind="trick" data-id="2" data-seat="0"><summary>line</summary></details>',
    );
  });
});

describe('historyHtml', () => {
  test('one row per event, in the stream order, newest last', () => {
    const rows = rowsIn(historyHtml(STREAM, COPY, CTX).markup);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => /data-id="(\d+)"/.exec(r)?.[1])).toEqual(['0', '1', '2']);
    expect(rows[2]).toContain('<span class="who">Ari</span> took the trick · 3 points');
    expect(rows[2]).not.toContain('data-value');
  });

  test("an empty stream is the copy's note, or nothing when the copy has none", () => {
    expect(historyHtml([], COPY, CTX).markup).toBe(
      '<div class="empty-note">Nothing has happened yet.</div>',
    );
    expect(historyHtml([], { summary: () => '', detail: () => [] }, CTX).markup).toBe('');
  });
});

describe('historyKey', () => {
  test('the last id, or - for none', () => {
    expect(historyKey(STREAM)).toBe('2');
    expect(historyKey([])).toBe('-');
  });
});

const page = (): FakePage => fakePage([fakeEl(HISTORY_IDS.list)]);

describe('paintHistory', () => {
  test('paints the rows and records the last id as the key', () => {
    const p = page();
    paintHistory(p.doc, HISTORY_IDS.list, STREAM, COPY, CTX);
    const list = p.get(HISTORY_IDS.list);
    expect(list.attr('data-key')).toBe('2');
    expect(rowsIn(list.text())).toHaveLength(3);
  });

  test('the same stream leaves the list as the player left it; a new event rebuilds it', () => {
    const p = page();
    paintHistory(p.doc, HISTORY_IDS.list, STREAM, COPY, CTX);
    const list = p.get(HISTORY_IDS.list);
    // The browser opened a row (a `<details>` toggled by the player); a repaint of the same
    // stream must not rebuild over it.
    setAttr(list.el, 'data-opened', '1');
    paintHistory(p.doc, HISTORY_IDS.list, STREAM, COPY, CTX);
    expect(list.attr('data-opened')).toBe('1');
    expect(list.attr('data-key')).toBe('2');
    paintHistory(p.doc, HISTORY_IDS.list, [...STREAM, ev(3, 'result', null)], COPY, CTX);
    expect(list.attr('data-key')).toBe('3');
    expect(rowsIn(list.text())).toHaveLength(4);
    expect(list.text()).toContain('<summary>Game over</summary>');
  });

  test('a new event of the same named stream is appended after the rows there, so an open row survives it; another name, restarted ids or a foreign last row rebuild the list', () => {
    const lastRow = fakeEl('lastRow', { attrs: { 'data-id': '2' } });
    const p = fakePage([
      fakeEl(HISTORY_IDS.list, { queries: { 'details.history-row:last-of-type': [lastRow] } }),
    ]);
    paintHistory(p.doc, HISTORY_IDS.list, STREAM, COPY, CTX, 'match-1');
    const list = p.get(HISTORY_IDS.list);
    expect(list.attr('data-key')).toBe('match-1:2');
    const painted = list.text();
    // The browser holds an opened <details>; the fake shows the content untouched, plus a mark.
    list.el.insertAdjacentHTML('beforeend', '<!--open-->');
    const next = ev(3, 'result', null);
    paintHistory(p.doc, HISTORY_IDS.list, [...STREAM, next], COPY, CTX, 'match-1');
    expect(list.attr('data-key')).toBe('match-1:3');
    expect(list.text()).toBe(`${painted}<!--open-->${historyRowHtml(next, COPY, CTX).markup}`);
    // The ids restarted under the same name: rebuilt whole.
    paintHistory(p.doc, HISTORY_IDS.list, STREAM.slice(0, 2), COPY, CTX, 'match-1');
    expect(list.attr('data-key')).toBe('match-1:1');
    expect(rowsIn(list.text())).toHaveLength(2);
    expect(list.text()).not.toContain('<!--open-->');
    // Another stream's name: rebuilt whole.
    paintHistory(p.doc, HISTORY_IDS.list, STREAM, COPY, CTX, 'match-2');
    expect(list.attr('data-key')).toBe('match-2:2');
    expect(rowsIn(list.text())).toHaveLength(3);
    // A stream that no longer carries the id the key names (the ids ran on without it): rebuilt
    // whole; so is a list painted empty (`-` is no id) once the stream has events.
    const gap = fakePage([
      fakeEl(HISTORY_IDS.list, {
        queries: {
          'details.history-row:last-of-type': [fakeEl('y', { attrs: { 'data-id': '2' } })],
        },
      }),
    ]);
    paintHistory(gap.doc, HISTORY_IDS.list, STREAM, COPY, CTX, 'g');
    gap.get(HISTORY_IDS.list).el.insertAdjacentHTML('beforeend', '<!--open-->');
    paintHistory(
      gap.doc,
      HISTORY_IDS.list,
      [ev(3, 'trick', 0, 4), ev(4, 'result', null)],
      COPY,
      CTX,
      'g',
    );
    expect(gap.get(HISTORY_IDS.list).text()).not.toContain('<!--open-->');
    expect(rowsIn(gap.get(HISTORY_IDS.list).text())).toHaveLength(2);
    const fromEmpty = page();
    paintHistory(fromEmpty.doc, HISTORY_IDS.list, [], COPY, CTX, 'g');
    expect(fromEmpty.get(HISTORY_IDS.list).attr('data-key')).toBe('g:-');
    paintHistory(fromEmpty.doc, HISTORY_IDS.list, STREAM, COPY, CTX, 'g');
    expect(fromEmpty.get(HISTORY_IDS.list).attr('data-key')).toBe('g:2');
    expect(rowsIn(fromEmpty.get(HISTORY_IDS.list).text())).toHaveLength(3);
    // The last row is not the one the key names (something else rewrote the list): rebuilt whole.
    const foreign = fakePage([
      fakeEl(HISTORY_IDS.list, {
        queries: {
          'details.history-row:last-of-type': [fakeEl('x', { attrs: { 'data-id': '1' } })],
        },
      }),
    ]);
    paintHistory(foreign.doc, HISTORY_IDS.list, STREAM, COPY, CTX, 'm');
    foreign.get(HISTORY_IDS.list).el.insertAdjacentHTML('beforeend', '<!--open-->');
    paintHistory(foreign.doc, HISTORY_IDS.list, [...STREAM, next], COPY, CTX, 'm');
    expect(foreign.get(HISTORY_IDS.list).text()).not.toContain('<!--open-->');
    expect(rowsIn(foreign.get(HISTORY_IDS.list).text())).toHaveLength(4);
  });

  test('an empty stream paints the note under the - key', () => {
    const p = page();
    paintHistory(p.doc, HISTORY_IDS.list, [], COPY, CTX);
    expect(p.get(HISTORY_IDS.list).attr('data-key')).toBe('-');
    expect(p.get(HISTORY_IDS.list).text()).toBe(
      '<div class="empty-note">Nothing has happened yet.</div>',
    );
  });
});

describe('scrollHistoryToEnd', () => {
  test('scrolls the last row into view, and nothing when the list has none', () => {
    const last = fakeEl('lastRow');
    const withRows = fakePage([
      fakeEl(HISTORY_IDS.list, { queries: { 'details.history-row:last-of-type': [last] } }),
    ]);
    scrollHistoryToEnd(withRows.doc, HISTORY_IDS.list);
    expect(last.scrolledInto()).toBe(1);
    const empty = page();
    scrollHistoryToEnd(empty.doc, HISTORY_IDS.list);
    expect(last.scrolledInto()).toBe(1);
  });
});
