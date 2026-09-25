// The history copy over the engine's event stream (docs/design/briscola-sound-history.md §6),
// read through the shared panel (web/shared/ui/history.ts): one `<details>` per event, the
// summary with its actor lifted out as the chip, the detail pairs as a `<dl>`, a trick's value
// class on the row, newest last, the empty note; a line that does not open with its actor is
// printed whole; names escaped by the panel. The list's keys and the appended rows are the shared
// panel's own tests. A result row is the game's alone: the engine's match clause and its tally row
// stay off the sheet (one game per sitting, the owner, 2026-09-25).
import { describe, expect, test } from 'vitest';

import { historyHtml, historyRowHtml } from '../../../../shared/ui/history.ts';
import {
  cardById,
  detailOf,
  summaryOf,
  type Card,
  type GameEvent,
  type Player,
} from '../engine/index.ts';
import {
  EMPTY_HISTORY_MSG,
  HISTORY_COPY,
  detailText,
  lineOf,
  summaryText,
  valueOf,
  whoOf,
  type HistoryCtx,
} from './history.ts';

const PLAYERS: ReadonlyArray<Player> = [
  { id: 'p1', name: 'Ari' },
  { id: 'p2', name: 'Jeff' },
];
const CTX: HistoryCtx = { players: PLAYERS, n: 2 };
const row = (e: GameEvent, ctx: HistoryCtx = CTX): string =>
  historyRowHtml(e, HISTORY_COPY, ctx).markup;
const card = (id: string): Card => {
  const c = cardById(id);
  if (c === null) throw new Error(`no card ${id}`);
  return c;
};

const DEAL: GameEvent = {
  id: 0,
  kind: 'deal',
  seat: 0,
  at: 1,
  data: { dealer: 0, trumpCard: card('7B') },
};
const TRICK: GameEvent = {
  id: 1,
  kind: 'trick',
  seat: 1,
  at: 2,
  data: {
    no: 1,
    leader: 0,
    cards: [
      { seat: 0, card: card('AC') },
      { seat: 1, card: card('2B') },
    ],
    winner: 1,
    winnerSide: 1,
    points: 11,
    valueClass: 'big',
    winningCard: card('2B'),
    winningClass: 'pip',
    briscola: true,
    steal: true,
    overtrump: false,
    carichiLost: [0],
    drew: [1, 0],
    trumpTaken: null,
  },
};
const GAME: GameEvent = { id: 2, kind: 'game', seat: null, at: 3, data: { gameNo: 2, dealer: 1 } };
const RESULT: GameEvent = {
  id: 3,
  kind: 'result',
  seat: null,
  at: 4,
  data: { winner: 1, totals: [53, 67], draw: false, decided: false, wins: [0, 1] },
};
const EVENTS: ReadonlyArray<GameEvent> = [DEAL, TRICK, GAME, RESULT];

describe('the copy, rendered by the shared panel', () => {
  test('a trick row: kind, id, seat and value class; the actor as the chip; every detail pair', () => {
    const html = row(TRICK);
    expect(
      html.startsWith(
        '<details class="history-row" data-kind="trick" data-id="1" data-seat="1" data-value="big"><summary><span class="who">Jeff</span> took the trick · 11 points · stolen with a briscola</summary><dl class="history-detail">',
      ),
    ).toBe(true);
    expect(html.endsWith('</dl></details>')).toBe(true);
    detailOf(TRICK, PLAYERS, 2).forEach(([label, value]) => {
      expect(html).toContain(`<dt>${label}</dt><dd>${value}</dd>`);
    });
    expect(html.match(/<dt>/g)).toHaveLength(detailOf(TRICK, PLAYERS, 2).length);
    expect(whoOf(TRICK, CTX)).toBe('Jeff');
    expect(summaryText(TRICK, CTX)).toBe('took the trick · 11 points · stolen with a briscola');
    expect(valueOf(TRICK)).toBe('big');
  });

  test('an event without an actor has no chip and no data-seat; the deal is chipped by its dealer', () => {
    expect(row(GAME)).toBe(
      '<details class="history-row" data-kind="game" data-id="2"><summary>Game 2 begins</summary><dl class="history-detail"><dt>Dealer</dt><dd>Jeff</dd></dl></details>',
    );
    expect(row(RESULT)).toContain(
      `data-kind="result" data-id="3"><summary>${lineOf(RESULT, CTX)}</summary>`,
    );
    expect(lineOf(RESULT, CTX)).toBe('Jeff wins 67–53');
    expect(row(DEAL)).toContain(
      '<summary><span class="who">Ari</span> dealt · the briscola is the sette di bastoni</summary>',
    );
    expect([GAME, RESULT, DEAL].map(valueOf)).toEqual([null, null, null]);
    expect(whoOf(RESULT, CTX)).toBeNull();
  });

  test('a result row reads the game`s result alone: no match clause in the line, no tally row in the detail, whatever the engine`s event says', () => {
    const decided: GameEvent = {
      ...RESULT,
      data: { winner: 0, totals: [71, 49], draw: false, decided: true, wins: [1, 0] },
    };
    expect(summaryOf(decided, PLAYERS, 2)).toBe('Ari wins 71–49 and takes the match 1–0');
    expect(lineOf(decided, CTX)).toBe('Ari wins 71–49');
    expect(whoOf(decided, CTX)).toBeNull();
    expect(summaryText(decided, CTX)).toBe('Ari wins 71–49');
    expect(detailOf(decided, PLAYERS, 2).map(([label]) => label)).toEqual(['Ari', 'Jeff', 'Match']);
    expect(detailText(decided, CTX)).toEqual([
      ['Ari', '71'],
      ['Jeff', '49'],
    ]);
    expect(row(decided)).toBe(
      '<details class="history-row" data-kind="result" data-id="3"><summary>Ari wins 71–49</summary><dl class="history-detail"><dt>Ari</dt><dd>71</dd><dt>Jeff</dt><dd>49</dd></dl></details>',
    );
    const drawn: GameEvent = {
      ...RESULT,
      data: { winner: null, totals: [60, 60], draw: true, decided: false, wins: [0, 0] },
    };
    expect(lineOf(drawn, CTX)).toBe('A draw, 60–60');
    // Every other kind is the engine's line and detail, untouched.
    expect(lineOf(TRICK, CTX)).toBe(summaryOf(TRICK, PLAYERS, 2));
    expect(detailText(TRICK, CTX)).toEqual(detailOf(TRICK, PLAYERS, 2));
  });

  test('a name is escaped in the chip and in the detail', () => {
    const odd: HistoryCtx = {
      players: [
        { id: 'p1', name: '<i>A</i>' },
        { id: 'p2', name: 'B&C' },
      ],
      n: 2,
    };
    const html = row(TRICK, odd);
    expect(html).toContain('<span class="who">B&amp;C</span>');
    expect(html).toContain('<dd>&lt;i&gt;A&lt;/i&gt; · asso di coppe</dd>');
    expect(html).not.toContain('<i>');
  });

  test('newest last, one row per event; the empty note before anything happened', () => {
    const html = historyHtml(EVENTS, HISTORY_COPY, CTX).markup;
    expect(html.match(/<details /g)).toHaveLength(4);
    expect(html.indexOf('data-id="0"')).toBeLessThan(html.indexOf('data-id="3"'));
    expect(html).toBe(EVENTS.map((e) => row(e)).join(''));
    expect(historyHtml([], HISTORY_COPY, CTX).markup).toBe(
      `<div class="empty-note">${EMPTY_HISTORY_MSG}</div>`,
    );
  });

  test('a summary that does not open with its actor is printed whole, with no chip', () => {
    // The dealer in the data is Ari, the row's seat says Jeff: nothing to lift out of the line.
    const odd: GameEvent = { ...DEAL, seat: 1 };
    expect(whoOf(odd, CTX)).toBeNull();
    expect(row(odd)).toContain(
      '<summary>Ari dealt · the briscola is the sette di bastoni</summary>',
    );
  });
});
