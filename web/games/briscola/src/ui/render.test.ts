// No jsdom here (docs/ARCHITECTURE.md "Testing pyramid"): the paint runs against the page fake
// built from the page's own markup (ui/page.fake.ts over web/games/briscola/index.html), so every
// id, initial class, value and data attribute is the real one. The Apps come from the reducer
// driven the way the page drives it (a seeded pass-and-play table for two and four, a position
// seated through `sandbox/load`), so what the painter sees is what main.ts hands it. The fake keeps
// a container's markup as a string and knows no children unless a test declares them, so the keyed
// rebuilds are read off `data-key` and the markup, and the toggles outside a key off declared cards.
import { describe, expect, test } from 'vitest';

import { NOW, runIntents } from '../../../../../test/shared/engine-helpers.ts';
import { fakeEl, fakeTarget, type FakeEl } from '../../../../shared/edge/page.fake.ts';
import { packByName } from '../../../../shared/lib/cards/packs.ts';
import { resolveAspect } from '../../../../shared/lib/cards/resolve.ts';
import { mulberry32 } from '../../../../shared/lib/rng.ts';
import {
  SUIT_NAME,
  cardById,
  deckFor,
  nameOf,
  withPosition,
  type Card,
  type State,
  type View,
} from '../engine/index.ts';
import { historyKey } from '../../../../shared/ui/history.ts';
import { briscolaPage, type BriscolaPage } from './page.fake.ts';
import {
  DRAWING_STATUS,
  bindAll,
  connDotClass,
  handIntentOf,
  matchSubText,
  matchText,
  matchTitle,
  nextLabel,
  paint,
  paintScreen,
  paintSound,
  paintWaiting,
  resultLine,
  resultSheetText,
  statusText,
  takesText,
} from './render.ts';
import {
  DEFAULT_OPTS,
  SCREENS,
  initialApp,
  reduce,
  type App,
  type HomeSnapshot,
  type Intent,
  type Raw,
} from './state.ts';
import { handKey, trickKey } from './table.ts';

import MARKUP from '../../index.html?raw';

const page = (): BriscolaPage => briscolaPage(MARKUP);
const ctx = { rng: mulberry32(7), now: () => NOW };
const run = runIntents(reduce, ctx);
const game = (app: App): State => {
  const g = app.shell.game;
  if (g === null) throw new Error('no game');
  return g;
};
const view = (app: App): View => {
  const v = app.shell.view;
  if (v === null) throw new Error('no view');
  return v;
};
const home: HomeSnapshot = {
  name: null,
  p2Name: null,
  homeTab: 'play',
  playMode: 'local',
  soundFont: 'default',
  save: null,
  opts: DEFAULT_OPTS,
  cardPack: 'linea',
  p3Name: null,
  p4Name: null,
};
/** A pass-and-play table, curtain up for the leader; `raw` picks the seats and the rules. */
const local = (raw: Raw = {}): App =>
  run(
    initialApp,
    { type: 'home/init', home },
    { type: 'local/click', p1: 'Ann', p2: 'Bob', ...raw },
  ).app;
/** The curtain lifted for whoever must act. */
const revealed = (app: App): App => run(app, { type: 'curtain/reveal' }).app;
/** The tap policy: the first legal card lifted, then played (two taps). */
const playFirst = (app: App): App => {
  const id = view(app).legal[0];
  if (id === undefined) throw new Error('nothing legal');
  return run(app, { type: 'card/tap', cardId: id }, { type: 'card/tap', cardId: id }).app;
};
const elapsed = (app: App): App => run(app, { type: 'settle/elapsed' }).app;
/** The settle beat run to its end (at most the three stages). */
const settled = (app: App): App =>
  Array.from({ length: 3 }).reduce<App>((a) => (a.table.settle === null ? a : elapsed(a)), app);
const shown = (p: BriscolaPage): ReadonlyArray<string> =>
  SCREENS.filter((id) => !p.get(id).hidden());
const c = (id: string): Card => {
  const card = cardById(id);
  if (card === null) throw new Error(`no card ${id}`);
  return card;
};
/**
 * The last trick of a game (E22): each seat holds one card, the stock is out, Ann leads the asso di
 * coppe against Bob's tre di coppe and takes 21 points; every other card is Ann's already.
 */
const lastTrickPosition = (app: App): App => {
  const g = game(app);
  const rest = deckFor(g.options).filter((card) => card.id !== 'AC' && card.id !== '3C');
  const state: State = {
    ...withPosition(g, [[c('AC')], [c('3C')]], [], c('RB'), 0),
    piles: [rest, []],
  };
  return run(app, { type: 'position/load', state: JSON.parse(JSON.stringify(state)) }).app;
};
const recorder = (): Readonly<{ intents: Intent[]; dispatch: (i: Intent) => void }> => {
  const intents: Intent[] = [];
  return { intents, dispatch: (i) => intents.push(i) };
};
/** A hand's three slots declared on the page, each holding a card fake with the id the paint wrote (`data-card`). */
const declareHand = (
  ids: ReadonlyArray<string>,
): Readonly<{
  page: BriscolaPage;
  cards: ReadonlyMap<string, FakeEl>;
  slots: ReadonlyArray<FakeEl>;
}> => {
  const cards = new Map(
    ids.map((id) => [id, fakeEl(`card-${id}`, { attrs: { 'data-card': id } })]),
  );
  const slots = ids.map((id) =>
    fakeEl(`slot-${id}`, { queries: { '.card': [cards.get(id) ?? fakeEl('x')] } }),
  );
  const p = briscolaPage(MARKUP, { hand: { queries: { '.slot': slots } } }, [
    ...slots,
    ...cards.values(),
  ]);
  return { page: p, cards, slots };
};

describe('the shell painters and the pack', () => {
  test('paintScreen shows one screen and fixes the body at the table; paintWaiting and paintSound', () => {
    const p = page();
    paintScreen(p.doc, initialApp);
    expect(shown(p)).toEqual(['homeScreen']);
    expect(p.body.hasClass('fixed-screen')).toBe(false);
    paintScreen(p.doc, { ...initialApp, shell: { ...initialApp.shell, screen: 'tableScreen' } });
    expect(shown(p)).toEqual(['tableScreen']);
    expect(p.body.hasClass('fixed-screen')).toBe(true);
    paintWaiting(p.doc, {
      ...initialApp,
      shell: {
        ...initialApp.shell,
        code: 'KQZM',
        hostStatus: { text: 'Jeff joined! Ready when you are.', pulse: false },
        startGameVisible: true,
      },
    });
    expect(p.get('roomCode').text()).toBe('KQZM');
    expect(p.get('hostWaitStatus').hasClass('pulse')).toBe(false);
    expect(p.get('startGameBtn').hidden()).toBe(false);
    paintSound(p.doc, false);
    expect(p.get('soundBtn').text()).toBe('🔇');
    expect(p.get('soundBtn').attr('aria-pressed')).toBe('false');
  });

  test('connDotClass: on/off, hidden in pass-and-play', () => {
    expect(connDotClass(initialApp)).toBe('conn-dot off');
    expect(connDotClass(local())).toBe('conn-dot on hidden');
  });

  test('paint at home: the pack`s tokens written once, the table untouched, the sheets down', () => {
    const p = page();
    paint(p.doc, run(initialApp, { type: 'home/init', home }).app);
    expect(shown(p)).toEqual(['homeScreen']);
    expect(p.body.attr('data-card-pack')).toBe('linea');
    const linea = packByName('linea');
    expect(p.get('tableScreen').style('--aspect')).toBe(String(resolveAspect(linea, 'italian40')));
    expect(p.get('tableScreen').style('--back')).toMatch(/^url\(/);
    expect(p.get('tableScreen').style('--back-colour')).not.toBeNull();
    // The body carries the same tokens, for the cards a flight clones onto it.
    expect(p.body.style('--back')).toBe(p.get('tableScreen').style('--back'));
    expect(p.body.style('--aspect')).toBe(p.get('tableScreen').style('--aspect'));
    expect(p.get('hand').attr('data-key')).toBeNull();
    expect(p.get('trick').text()).toBe('');
    expect(p.get('resultOverlay').hidden()).toBe(true);
    expect(p.get('curtainOverlay').hidden()).toBe(true);
    expect(p.get('handoffBtn').hidden()).toBe(true);
    expect(p.get('tableScreen').attr('data-beat')).toBeNull();
    // Another pack: the body attribute changes and the tokens follow it.
    paint(
      p.doc,
      run(initialApp, { type: 'home/init', home: { ...home, cardPack: 'default' } }).app,
    );
    expect(p.body.attr('data-card-pack')).toBe('default');
    expect(p.get('tableScreen').style('--aspect')).toBe(
      String(resolveAspect(packByName('default'), 'italian40')),
    );
  });
});

describe('the two-player table', () => {
  test('a new pass-and-play game: every container keyed from the deal, the curtain up, the hand down and inert', () => {
    const p = page();
    const app = local();
    paint(p.doc, app);
    const v = view(app);
    const me = v.me.idx;
    const other = v.others[0];
    if (other === undefined) throw new Error('no opponent');
    expect(shown(p)).toEqual(['tableScreen']);
    expect(p.get('curtainOverlay').hidden()).toBe(false);
    expect(p.get('handoffBtn').hidden()).toBe(false);
    // The hand: the three dealt cards left to right, face down under the curtain, inert.
    const ids = v.me.hand.map((card) => card.id);
    expect(app.table.slots).toEqual(ids);
    expect(p.get('hand').attr('data-key')).toBe(handKey(ids, 'linea', true));
    expect(p.get('hand').hasClass('hidden-cards')).toBe(true);
    expect(p.get('hand').hasClass('inert')).toBe(true);
    expect(p.get('hand').hasClass('active')).toBe(false);
    expect(p.get('hand').text()).not.toContain('data-card=');
    expect(p.get('myName').text()).toBe(v.me.name);
    expect(p.get('myTaken').text()).toBe('You: 0');
    // The seats: the one opponent across the top with its dot, the side cells put away.
    expect(p.get('seats').attr('data-players')).toBe('2');
    expect(p.get('seatR2').attr('hidden')).toBeNull();
    expect(p.get('seatR2').attr('data-seat')).toBe(String(other.idx));
    expect(p.get('seatR2').text()).toContain(
      `<span class="seat-name" id="oppName">${other.name}</span>`,
    );
    expect(p.get('seatR2').text()).toContain('id="oppDot"');
    expect(p.get('seatR2').text()).toContain('data-count="0"');
    expect(
      (
        p
          .get('seatR2')
          .text()
          .match(/class="card back tiny"/g) ?? []
      ).length,
    ).toBe(3);
    expect(p.get('seatR1').attr('hidden')).toBe('');
    expect(p.get('seatR3').attr('hidden')).toBe('');
    // The stock with the briscola under it, the trump badge naming the suit.
    expect(p.get('stock').attr('data-count')).toBe('34');
    expect(p.get('stock').text()).toBe('<div class="card back mid"></div>');
    expect(p.get('stock').hasClass('empty')).toBe(false);
    expect(p.get('stockCount').text()).toBe('Stock · 34');
    expect(p.get('briscola').text()).toContain(`data-card="${v.trumpCard.id}"`);
    expect(p.get('briscola').hasClass('gone')).toBe(false);
    const suit = SUIT_NAME[v.trumpCard.s];
    expect(p.get('trumpBadge').hasClass(`s-${suit}`)).toBe(true);
    expect(
      p
        .get('trumpBadge')
        .classes()
        .filter((k) => k.startsWith('s-')),
    ).toEqual([`s-${suit}`]);
    expect(p.trumpUse.attr('href')).toBe(`#suit-${v.trumpCard.s}`);
    expect(p.get('trumpName').text()).toBe(suit);
    expect(p.get('gameBadge').text()).toBe('Game 1 · 0–0 · best of 3');
    // The empty trick shows the leader's cue; the strip a cell per player; the status whose turn.
    expect(p.get('trick').text()).toBe('');
    expect(p.get('trick').attr('data-lead')).toBe('You lead');
    expect(p.get('trick').attr('data-players')).toBe('2');
    expect(p.get('scoreStrip').attr('data-mode')).toBe('players');
    // The cells in side order (seat 0 first), mine marked.
    expect(p.get('scoreStrip').attr('data-key')).toBe(
      `players|0:0,0:0|${([0, 1] as const).map((s) => `${nameOf(v.players, s)}${s === me ? ' (you)' : ''}`).join(',')}`,
    );
    expect(p.get('scoreStrip').text()).toContain(`<span class="sc-name">${v.me.name} (you)</span>`);
    expect(p.get('statusText').text()).toBe('Your turn — play a card');
    expect(statusText(app, v)).toBe('Your turn — play a card');
    expect(p.get('playBtn').disabled()).toBe(true);
    expect(p.get('waitNote').hidden()).toBe(true);
    expect(p.get('lastTrickSheetBtn').disabled()).toBe(true);
    expect(p.get('lastTrickBtn').disabled()).toBe(true);
    expect(p.get('resultOverlay').hidden()).toBe(true);
    expect(p.get('tableScreen').attr('data-beat')).toBeNull();
  });

  test('revealed: the hand live; a lift toggles outside the key and enables Play; a tap on the felt is nothing', () => {
    const app = revealed(local());
    const v = view(app);
    const ids = v.me.hand.map((card) => card.id);
    const { page: p, cards, slots } = declareHand(ids);
    paint(p.doc, app);
    expect(p.get('curtainOverlay').hidden()).toBe(true);
    expect(p.get('hand').attr('data-key')).toBe(handKey(ids, 'linea'));
    expect(p.get('hand').hasClass('active')).toBe(true);
    expect(p.get('hand').hasClass('hidden-cards')).toBe(false);
    // A fresh build paints `playable` on every held card; the slots are the accessible buttons.
    expect(
      (
        p
          .get('hand')
          .text()
          .match(/ playable"/g) ?? []
      ).length,
    ).toBe(3);
    expect(p.get('hand').text()).toContain('role="button" tabindex="0" aria-pressed="false"');
    ids.forEach((id) => {
      expect(cards.get(id)?.hasClass('playable')).toBe(true);
      expect(cards.get(id)?.hasClass('selected')).toBe(false);
    });
    expect(slots[0]?.attr('aria-label')).toMatch(/, play$/);
    // The lift: the same key (nothing rebuilt), the tapped card `selected`, its slot pressed, Play live.
    const [first, second] = ids;
    if (first === undefined || second === undefined) throw new Error('short hand');
    const lifted = run(app, { type: 'card/tap', cardId: first }).app;
    paint(p.doc, lifted);
    expect(p.get('hand').attr('data-key')).toBe(handKey(ids, 'linea'));
    expect(cards.get(first)?.hasClass('selected')).toBe(true);
    expect(cards.get(second)?.hasClass('selected')).toBe(false);
    expect(slots[0]?.attr('aria-pressed')).toBe('true');
    expect(slots[0]?.attr('aria-label')).toMatch(/, lifted$/);
    expect(p.get('playBtn').disabled()).toBe(false);
    // The lift moved: the ring with it.
    const moved = run(lifted, { type: 'card/tap', cardId: second }).app;
    paint(p.doc, moved);
    expect(cards.get(first)?.hasClass('selected')).toBe(false);
    expect(cards.get(second)?.hasClass('selected')).toBe(true);
    // The same App again: nothing changes.
    paint(p.doc, moved);
    expect(cards.get(second)?.hasClass('selected')).toBe(true);
    expect(p.get('hand').attr('data-key')).toBe(handKey(ids, 'linea'));
  });

  test('a card played: the trick keyed on `seat:card`, the hand keeps its hole, the phone changes hands', () => {
    const p = page();
    const app = revealed(local());
    const v = view(app);
    const me = v.me.idx;
    const played = playFirst(app);
    paint(p.doc, played);
    const ids = v.me.hand.map((card) => card.id);
    const laid = view(played).trick[0];
    if (laid === undefined) throw new Error('nothing laid');
    expect(laid.seat).toBe(me);
    expect(laid.card.id).toBe(ids[0]);
    expect(p.get('trick').attr('data-key')).toBe(`${trickKey([laid])}|linea`);
    expect(p.get('trick').text()).toContain(`data-seat="${String(me)}"`);
    expect(p.get('trick').text()).toContain(`style="--i:0"`);
    expect(p.get('trick').text()).toContain(`<span class="who">${v.me.name}</span>`);
    expect(p.get('trick').attr('data-lead')).toBe('');
    // The other player's turn: the curtain rises for them and the hand shown is theirs, face down.
    const next = view(played);
    expect(next.me.idx).not.toBe(me);
    expect(played.table.curtain).toBe(next.me.idx);
    expect(p.get('curtainTitle').text()).toBe(`Pass the phone to ${next.me.name}`);
    expect(p.get('hand').hasClass('hidden-cards')).toBe(true);
    expect(p.get('hand').attr('data-key')).toBe(
      handKey(
        next.me.hand.map((card) => card.id),
        'linea',
        true,
      ),
    );
    // My side of the table as they see it: my seat holds two cards and is not to move.
    expect(
      (
        p
          .get('seatR2')
          .text()
          .match(/class="card back tiny"/g) ?? []
      ).length,
    ).toBe(2);
    expect(p.get('seatR2').hasClass('to-move')).toBe(false);
    expect(p.get('statusText').text()).toBe('Your turn — play a card');
  });

  test('the settle beat: the taker marked and the counts held through hold and fly, the stock through the draw, then the cold paint', () => {
    const p = page();
    const one = playFirst(revealed(local()));
    const holder = view(revealed(one));
    const two = playFirst(revealed(one));
    const settle = two.table.settle;
    if (settle === null) throw new Error('no settle');
    expect(settle.stage).toBe('hold');
    const trick = settle.trick;
    const v = view(two);
    expect(v.me.idx).toBe(holder.me.idx);
    const me = v.me.idx;
    const start = game(two).startedAt;
    paint(p.doc, two);
    // Hold: both cards on the table, the winner's `taking`; the tallies as before the trick.
    expect(p.get('trick').attr('data-key')).toBe(`${trickKey(trick.cards)}|linea`);
    expect(p.get('trick').text()).toContain(' taking"');
    expect(p.get('trick').text()).toContain(`data-seat="${String(trick.winner)}"`);
    expect(p.get('statusText').text()).toBe(takesText(v.players, me, trick));
    expect(p.get('scoreStrip').attr('data-key')).toMatch(/^players\|0:0,0:0\|/);
    expect(p.get('myTaken').text()).toBe('You: 0');
    expect(p.get('stock').attr('data-count')).toBe('34');
    expect(p.get('stockCount').text()).toBe('Stock · 34');
    expect(v.stockCount).toBe(32);
    expect(p.get('tableScreen').attr('data-beat')).toBe(`${String(start)}:1:1:hold`);
    expect(p.get('hand').hasClass('inert')).toBe(true);
    expect(p.get('seatR2').hasClass('to-move')).toBe(false);
    // Fly: the same picture, the beat marked; the seats still hold two cards.
    const fly = elapsed(two);
    paint(p.doc, fly);
    expect(fly.table.settle?.stage).toBe('fly');
    expect(p.get('tableScreen').attr('data-beat')).toBe(`${String(start)}:1:1:fly`);
    expect(p.get('statusText').text()).toBe(takesText(v.players, me, trick));
    expect(
      (
        p
          .get('seatR2')
          .text()
          .match(/class="card back tiny"/g) ?? []
      ).length,
    ).toBe(2);
    // Draw: "Drawing…", the tallies scored, the seats refilled, the stock still as before the draw.
    const draw = elapsed(fly);
    paint(p.doc, draw);
    expect(draw.table.settle?.stage).toBe('draw');
    expect(p.get('statusText').text()).toBe(DRAWING_STATUS);
    expect(p.get('tableScreen').attr('data-beat')).toBe(`${String(start)}:1:1:draw`);
    expect(
      (
        p
          .get('seatR2')
          .text()
          .match(/class="card back tiny"/g) ?? []
      ).length,
    ).toBe(3);
    expect(p.get('stock').attr('data-count')).toBe('34');
    const winnerSide = trick.winner;
    expect(p.get('scoreStrip').attr('data-key')).toContain(
      winnerSide === me ? `${String(trick.points)}:1,0:0` : `0:0,${String(trick.points)}:1`,
    );
    // Cold: the stock thinned, the trick cleared for the winner's lead, the beat forgotten.
    const cold = elapsed(draw);
    expect(cold.table.settle).toBeNull();
    paint(p.doc, cold);
    expect(p.get('stock').attr('data-count')).toBe('32');
    expect(p.get('stockCount').text()).toBe('Stock · 32');
    expect(p.get('trick').text()).toBe('');
    expect(p.get('tableScreen').attr('data-beat')).toBeNull();
    expect(p.get('lastTrickSheetBtn').disabled()).toBe(false);
    // The last-trick sheet shows it with the winner's card taking.
    const peek = run(cold, { type: 'lastTrick/open' }).app;
    paint(p.doc, peek);
    expect(p.get('lastTrickOverlay').hidden()).toBe(false);
    expect(p.get('ltTitle').text()).toBe('Trick 1');
    expect(p.get('ltCards').text()).toContain(' taking"');
    expect(p.get('ltSub').text()).toMatch(/ took it · \d+ points$/);
  });

  test('four players: three cells with their seats, the strip per team, the handoff not offered', () => {
    const p = page();
    const app = local({ localPlayers: '4', p3: 'Cara', p4: 'Dan' });
    paint(p.doc, app);
    const v = view(app);
    const me = v.me.idx;
    expect(p.get('seats').attr('data-players')).toBe('4');
    expect(p.get('seatR1').attr('hidden')).toBeNull();
    expect(p.get('seatR2').attr('hidden')).toBeNull();
    expect(p.get('seatR3').attr('hidden')).toBeNull();
    expect(p.get('seatR1').attr('data-seat')).toBe(String((me + 1) % 4));
    expect(p.get('seatR2').attr('data-seat')).toBe(String((me + 2) % 4));
    expect(p.get('seatR3').attr('data-seat')).toBe(String((me + 3) % 4));
    expect(p.get('seatR2').text()).not.toContain('id="oppDot"');
    expect(p.get('trick').attr('data-players')).toBe('4');
    expect(p.get('scoreStrip').attr('data-mode')).toBe('teams');
    expect(p.get('scoreStrip').text()).toContain('Ann &amp; Cara');
    expect(p.get('scoreStrip').text()).toContain('Bob &amp; Dan');
    expect(
      (
        p
          .get('scoreStrip')
          .text()
          .match(/class="score-cell/g) ?? []
      ).length,
    ).toBe(2);
    expect(p.get('stockCount').text()).toBe('Stock · 28');
    expect(p.get('handoffBtn').hidden()).toBe(true);
    expect(p.get('curtainHandoffBtn').hidden()).toBe(true);
  });
});

describe('the history sheet', () => {
  test("one row per event through the shared panel, keyed on the match and the last event, so an open row survives a repaint; a new event is appended (the shared panel's test) or, on this fake without a last row, rebuilt", () => {
    const p = page();
    const app = run(revealed(local()), { type: 'history/open' }).app;
    paint(p.doc, app);
    const v = view(app);
    expect(p.get('historyOverlay').hidden()).toBe(false);
    expect(p.get('historyList').attr('data-key')).toBe(
      `${String(v.startedAt)}:${historyKey(v.events)}`,
    );
    expect(
      (
        p
          .get('historyList')
          .text()
          .match(/<details class="history-row"/g) ?? []
      ).length,
    ).toBe(v.events.length);
    expect(p.get('historyList').text()).toContain('data-kind="deal"');
    // A repaint with nothing new leaves the list alone (an open `<details>` stays open).
    const list = p.get('historyList').el as unknown as {
      insertAdjacentHTML: (w: string, m: string) => void;
    };
    list.insertAdjacentHTML('beforeend', '<i id="open-mark"></i>');
    paint(p.doc, run(app, { type: 'card/tap', cardId: v.legal[0] ?? '' }).app);
    expect(p.get('historyList').text()).toContain('open-mark');
    // A trick resolved is a new event: its row arrives, newest last (appended after the open one in a
    // browser; this fake answers no last-row query, so the shared panel rebuilds).
    const after = settled(playFirst(revealed(playFirst(app))));
    const w = view(after);
    paint(p.doc, run(after, { type: 'history/open' }).app);
    expect(w.events.at(-1)?.kind).toBe('trick');
    expect(p.get('historyList').attr('data-key')).toBe(
      `${String(w.startedAt)}:${historyKey(w.events)}`,
    );
    expect(p.get('historyList').text()).not.toContain('open-mark');
    expect(p.get('historyList').text()).toMatch(
      /<details class="history-row" data-kind="trick"[^>]*><summary>.* took the trick · \d+ points/,
    );
    expect(p.get('historyList').text()).toContain('<dl class="history-detail"><dt>Led</dt>');
    paint(p.doc, run(after, { type: 'history/close' }).app);
    expect(p.get('historyOverlay').hidden()).toBe(true);
    // Another table whose stream ends at the same id is another list: its own deal, not the last game's.
    const other = run(local({ localPlayers: '4', p3: 'Cara', p4: 'Dan' }), {
      type: 'history/open',
    }).app;
    const o = view(other);
    expect(historyKey(o.events)).toBe(historyKey(v.events));
    paint(p.doc, other);
    expect(p.get('historyList').attr('data-key')).toBe(
      `${String(o.startedAt)}:${historyKey(o.events)}`,
    );
    expect(p.get('historyList').text()).toContain(`${nameOf(o.players, o.dealer)}</span> dealt`);
  });
});

describe('the game over, the result sheet and the match end', () => {
  test('the last trick: the stock out, the briscola gone; the result sheet once settled, put away and back; Next deals again', () => {
    const p = page();
    const start = lastTrickPosition(local());
    const v = view(start);
    expect(v.me.name).toBe('Ann');
    expect(start.table.curtain).toBeNull();
    paint(p.doc, start);
    expect(p.get('stock').attr('data-count')).toBe('0');
    expect(p.get('stock').hasClass('empty')).toBe(true);
    expect(p.get('stock').text()).toBe('');
    expect(p.get('briscola').hasClass('gone')).toBe(true);
    expect(p.get('hand').attr('data-key')).toBe(handKey(['AC', null, null], 'linea'));
    expect(p.get('statusText').text()).toBe('Your turn — play a card');
    // Ann leads the asso, Bob answers with the tre: the game is over once the beat has played.
    const over = settled(playFirst(revealed(playFirst(start))));
    const w = view(over);
    expect(w.phase).toBe('over');
    expect(w.matchOver).toBe(false);
    paint(p.doc, over);
    expect(shown(p)).toEqual(['tableScreen']);
    expect(p.get('resultOverlay').hidden()).toBe(false);
    expect(p.get('rsTitle').text()).toBe('Ann wins the game');
    expect(p.get('rsSub').text()).toBe('120–0');
    expect(p.get('rsScore').text()).toBe(
      '<div class="score-row"><span class="who">Ann</span><span>120</span></div><div class="score-row"><span class="who">Bob</span><span>0</span></div>',
    );
    expect(p.get('rsMatch').text()).toBe('Games: Ann 1 · Bob 0 · best of 3');
    expect(p.get('rsNextBtn').text()).toBe('Next game');
    expect(p.get('rsNextBtn').disabled()).toBe(false);
    expect(p.get('statusText').text()).toBe(resultLine(w));
    expect(resultLine(w)).toBe('Ann wins 120–0');
    expect(
      resultSheetText({ ...w, result: { winner: null, totals: [60, 60], draw: true } }),
    ).toEqual({
      title: 'A draw',
      sub: '60–60 · nobody scores this game',
    });
    // Put away: the chip in the actions row brings it back.
    const peeked = run(over, { type: 'result/peek' }).app;
    paint(p.doc, peeked);
    expect(p.get('resultOverlay').hidden()).toBe(true);
    expect(p.get('resultChipBtn').hidden()).toBe(false);
    paint(p.doc, run(peeked, { type: 'result/open' }).app);
    expect(p.get('resultOverlay').hidden()).toBe(false);
    // Next: game two, the badge counting the win, the sheet down, the curtain up for the new leader.
    const next = run(over, { type: 'next/click' }).app;
    paint(p.doc, next);
    expect(view(next).gameNo).toBe(2);
    expect(p.get('gameBadge').text()).toBe('Game 2 · 1–0 · best of 3');
    expect(p.get('resultOverlay').hidden()).toBe(true);
    expect(p.get('stock').attr('data-count')).toBe('34');
    expect(p.get('curtainOverlay').hidden()).toBe(false);
  });

  test('the match end: the endgame screen with Bravi!, a row per game and Rematch; a guest waits for the host to deal', () => {
    const p = page();
    const over = settled(
      playFirst(revealed(playFirst(lastTrickPosition(local({ localMatch: '1' }))))),
    );
    const w = view(over);
    expect(w.matchOver).toBe(true);
    paint(p.doc, over);
    expect(shown(p)).toEqual(['endgameScreen']);
    expect(p.get('resultOverlay').hidden()).toBe(true);
    expect(p.get('resultTitle').text()).toBe('Bravi! Ann takes the match 1–0');
    expect(matchTitle(w)).toBe('Bravi! Ann takes the match 1–0');
    expect(p.get('resultSub').text()).toBe('1 game');
    expect(matchSubText({ ...w, match: { ...w.match, draws: 2 } })).toBe('1 game · 2 draws');
    expect(p.get('matchScore').text()).toBe(
      '<div class="score-row"><span>Game 1</span><span class="who">Ann</span><span>120–0</span></div>',
    );
    expect(p.get('nextGameBtn').text()).toBe('Rematch');
    expect(p.get('nextGameBtn').disabled()).toBe(false);
    expect(matchText(w)).toBe('Games: Ann 1 · Bob 0 · one game');
    const asGuest: App = { ...over, shell: { ...over.shell, role: 'guest' } };
    expect(nextLabel(asGuest, w)).toBe('Waiting for Ann to deal');
    paint(p.doc, asGuest);
    expect(p.get('nextGameBtn').disabled()).toBe(true);
  });
});

describe('bindAll', () => {
  test('the hand`s tap and keyboard, the table, the buttons (disabled ones dispatch nothing), the sheets and Escape', () => {
    const card = fakeEl('card-7D', { attrs: { 'data-card': '7D' } });
    const slot = fakeEl('slot-7D', { queries: { '.card': [card] } });
    const p = briscolaPage(MARKUP, {}, [card, slot]);
    const r = recorder();
    bindAll(p.doc, r.dispatch);
    p.get('hand').fire('click', { target: fakeTarget({ closest: { '.card': card } }) });
    p.get('hand').fire('click', { target: fakeTarget({ id: 'hand' }) });
    const key = p
      .get('hand')
      .fire('keydown', { key: ' ', target: fakeTarget({ closest: { '.slot': slot } }) });
    expect(key.wasPrevented()).toBe(true);
    p.get('hand').fire('keydown', { key: 'a', target: fakeTarget({ closest: { '.slot': slot } }) });
    p.get('trick').fire('click');
    p.get('briscola').fire('click');
    expect(r.intents).toEqual([
      { type: 'card/tap', cardId: '7D' },
      { type: 'card/tap', cardId: '7D' },
      { type: 'table/tap' },
      { type: 'exchange/click' },
    ]);
    expect(handIntentOf({ target: fakeTarget({}) } as unknown as Event)).toBeNull();
    // Disabled controls dispatch nothing; enabled ones their constant.
    p.get('playBtn').fire('click');
    p.get('lastTrickSheetBtn').fire('click');
    expect(r.intents).toHaveLength(4);
    p.get('rsNextBtn').fire('click');
    p.get('nextGameBtn').fire('click');
    p.get('leaveBtn').fire('click');
    p.get('historyBtn').fire('click');
    p.get('rulesBtnGame').fire('click');
    p.get('soundBtn').fire('click');
    p.get('handoffBtn').fire('click');
    p.get('resultChipBtn').fire('click');
    expect(r.intents.slice(4)).toEqual([
      { type: 'next/click' },
      { type: 'next/click' },
      { type: 'leave/request' },
      { type: 'history/open' },
      { type: 'rules/open' },
      { type: 'sound/toggle' },
      { type: 'handoff/click' },
      { type: 'result/open' },
    ]);
    // The sheets: a close button and a backdrop tap dispatch the sheet's intent; a tap inside does not.
    p.get('closeLastTrickBtn').fire('click');
    p.get('rsPeekBtn').fire('click');
    p.get('resultOverlay').fire('click', { target: fakeTarget({ id: 'resultOverlay' }) });
    p.get('resultOverlay').fire('click', { target: fakeTarget({ id: 'rsTitle' }) });
    p.get('closeHistoryBtn').fire('click');
    p.get('closeRulesBtn').fire('click');
    expect(r.intents.slice(12)).toEqual([
      { type: 'lastTrick/close' },
      { type: 'result/peek' },
      { type: 'result/peek' },
      { type: 'history/close' },
      { type: 'rules/close' },
    ]);
    // Escape: the open sheet's intent, else the table's `escape`.
    p.fire('keydown', { key: 'Escape' });
    expect(r.intents.at(-1)).toEqual({ type: 'escape' });
    p.get('rulesOverlay').el.classList.remove('hidden');
    p.fire('keydown', { key: 'Escape' });
    expect(r.intents.at(-1)).toEqual({ type: 'rules/close' });
    // The menu is the DOM's own: opened, closed by its rows (which dispatch), its close, its backdrop and Escape.
    const before = r.intents.length;
    expect(p.get('menuOverlay').hidden()).toBe(true);
    p.get('menuBtn').fire('click');
    expect(p.get('menuOverlay').hidden()).toBe(false);
    p.get('menuRulesBtn').fire('click');
    expect(p.get('menuOverlay').hidden()).toBe(true);
    expect(r.intents.slice(before)).toEqual([{ type: 'rules/open' }]);
    p.get('menuBtn').fire('click');
    p.get('menuHistoryBtn').fire('click');
    p.get('menuBtn').fire('click');
    p.get('menuLeaveBtn').fire('click');
    expect(r.intents.slice(before + 1)).toEqual([
      { type: 'history/open' },
      { type: 'leave/request' },
    ]);
    p.get('menuBtn').fire('click');
    p.get('closeMenuBtn').fire('click');
    expect(p.get('menuOverlay').hidden()).toBe(true);
    p.get('menuBtn').fire('click');
    p.get('menuOverlay').fire('click', { target: fakeTarget({ id: 'menuOverlay' }) });
    expect(p.get('menuOverlay').hidden()).toBe(true);
    p.get('menuBtn').fire('click');
    p.fire('keydown', { key: 'Escape' });
    expect(p.get('menuOverlay').hidden()).toBe(true);
  });
});
