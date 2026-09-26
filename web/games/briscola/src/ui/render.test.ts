// No jsdom here (docs/ARCHITECTURE.md "Testing pyramid"): the paint runs against the page fake
// built from the page's own markup (ui/page.fake.ts over web/games/briscola/index.html), so every
// id, initial class, value and data attribute is the real one. The Apps come from the reducer
// driven the way the page drives it (a seeded pass-and-play table for two and four, a position
// seated through `sandbox/load`), so what the painter sees is what main.ts hands it. The fake keeps
// a container's markup as a string and knows no children unless a test declares them, so the keyed
// rebuilds are read off `data-key` and the markup, and the toggles outside a key off declared cards.
import { trickFacts } from '../engine/index.ts';
import { variantFrom } from './variant.ts';
import { describe, expect, test } from 'vitest';

import { NOW, runIntents } from '../../../../../test/shared/engine-helpers.ts';
import { fakeEl, fakeTarget, type FakeEl } from '../../../../shared/edge/page.fake.ts';
import { packByName } from '../../../../shared/lib/cards/packs.ts';
import { langByName } from '../../../../shared/lib/lang/packs.ts';
import { resolveAspect } from '../../../../shared/lib/cards/resolve.ts';
import { mulberry32 } from '../../../../shared/lib/rng.ts';
import {
  SUIT_NAME,
  cardById,
  deckFor,
  nameOf,
  viewFor,
  withPosition,
  type Card,
  type Seat,
  type State,
  type View,
} from '../engine/index.ts';
import type { RecentGame } from '../../../../shared/lib/recentGames.ts';
import { historyKey } from '../../../../shared/ui/history.ts';
import { recentGamesHtml } from '../../../../shared/ui/recentGames.ts';
import { deckKey, deckOf, deckSubText } from './deck.ts';
import { briscolaPage, type BriscolaPage } from './page.fake.ts';
import {
  DRAWING_STATUS,
  DRAW_TAP_STATUS,
  PLAY_AGAIN_LABEL,
  bindAll,
  connDotClass,
  handIntentOf,
  paint,
  paintScreen,
  paintSound,
  paintWaiting,
  replayLabel,
  resultLine,
  resultSheetText,
  seatConnected,
  sideRowsHtml,
  statusText,
  takesText,
  IMPACT_SUIT,
  clashFxHtml,
} from './render.ts';
import {
  DEFAULT_OPTS,
  SCREENS,
  awaitingDraw,
  initialApp,
  reduce,
  type App,
  type HomeSnapshot,
  type Intent,
  type Raw,
} from './state.ts';
import { cardNameOf, handKey, trickKey } from './table.ts';
import { welcome } from '../protocol.ts';

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
  recentGames: [],
  opts: DEFAULT_OPTS,
  cardPack: 'linea',
  lang: 'it',
  speed: 'normal',
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
/** The draw's tap while the beat waits for it. */
const tapped = (app: App): App => run(app, { type: 'draw/tap' }).app;
/** The settle beat run to its end (at most the ten stages), the draw's tap taken where it waits. */
const settled = (app: App): App =>
  Array.from({ length: 12 }).reduce<App>(
    (a) => (a.table.settle === null ? a : awaitingDraw(a.table.settle) ? tapped(a) : elapsed(a)),
    app,
  );
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
  // The tip painter finds a held card by its id on `#hand`; the slot toggles find them through `.slot`.
  const byId = Object.fromEntries(
    ids.map((id) => [`.card[data-card="${id}"]`, [cards.get(id) ?? fakeEl('x')]]),
  );
  const p = briscolaPage(MARKUP, { hand: { queries: { '.slot': slots, ...byId } } }, [
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

  test('connDotClass: on/off (the legacy pair`s, or the seat`s when told), hidden in pass-and-play', () => {
    expect(connDotClass(initialApp)).toBe('conn-dot off');
    expect(connDotClass(initialApp, true)).toBe('conn-dot on');
    expect(connDotClass(local())).toBe('conn-dot on hidden');
    expect(connDotClass(local(), false)).toBe('conn-dot off hidden');
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
    // The faces are not fetched at home (the join flow must not queue forty requests): only at the table.
    expect(p.body.text()).not.toContain('face-preload');
    expect(p.body.attr('data-faces')).toBeNull();
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
    // The pack's forty faces are fetched now the table is up, hidden on the body, so a drawn card never shows blank for a round trip.
    const preload =
      p.body.text().match(/<div class="face-preload" hidden aria-hidden="true">(.*?)<\/div>/g) ??
      [];
    expect(preload).toHaveLength(1);
    expect(preload[0]?.match(/<img /g)).toHaveLength(40);
    expect(preload[0]).toContain('src="../../shared/cards/linea/italian40/AC.svg"');
    expect(p.body.attr('data-faces')).toBe('linea');
    // A second paint of the same pack appends nothing more.
    paint(p.doc, app);
    expect(p.body.text().match(/face-preload/g)).toHaveLength(1);
    // The hand: the three dealt cards left to right, face down under the curtain, inert.
    const ids = v.me.hand.map((card) => card.id);
    expect(app.table.slots).toEqual(ids);
    expect(p.get('hand').attr('data-key')).toBe(`${handKey(ids, 'linea', true)}|it`);
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
    // No trick taken: every strip is empty, its count 0.
    expect(p.get('myTricks').attr('data-count')).toBe('0');
    expect(p.get('myTricks').text()).toBe('');
    expect(p.get('seatR2').text()).toContain(
      '<span class="seat-taken" data-count="0" style="--n:0"></span>',
    );
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
    expect(p.get('hand').attr('data-key')).toBe(`${handKey(ids, 'linea')}|it`);
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
    expect(p.get('hand').attr('data-key')).toBe(`${handKey(ids, 'linea')}|it`);
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
    expect(p.get('hand').attr('data-key')).toBe(`${handKey(ids, 'linea')}|it`);
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
    expect(p.get('trick').attr('data-key')).toBe(`${trickKey([laid])}|linea|it`);
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
      `${handKey(
        next.me.hand.map((card) => card.id),
        'linea',
        true,
      )}|it`,
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

  test('the deal flies (PR-H): six backs leave the stock for my three slots and the seat`s three backs, hidden till they land; the same table repainted deals nothing, nor does the first play', () => {
    // Dealt through its own rng: the file's shared stream stays where the rows after this expect it.
    const own = runIntents(reduce, { rng: mulberry32(11), now: () => NOW });
    const app = own(
      initialApp,
      { type: 'home/init', home },
      { type: 'local/click', p1: 'Ann', p2: 'Bob' },
    ).app;
    const v = view(app);
    const clone = fakeEl('clone', { classes: ['card', 'back'] });
    const stockCard = fakeEl('stockTop', { classes: ['card', 'back'] });
    Object.assign(stockCard.el, {
      getBoundingClientRect: () => ({ left: 400, top: 200, width: 56, height: 91 }),
      cloneNode: () => clone.el,
    });
    const measured = (id: string, left: number): FakeEl => {
      const f = fakeEl(id, { classes: ['card', 'back'] });
      Object.assign(f.el, {
        getBoundingClientRect: () => ({ left, top: 600, width: 80, height: 130 }),
      });
      return f;
    };
    const mine = [1, 2, 3].map((k) => measured(`mine${String(k)}`, k * 100));
    const theirs = [1, 2, 3].map((k) => measured(`theirs${String(k)}`, k * 30));
    const p = briscolaPage(MARKUP, {
      stock: { queries: { '.card': [stockCard] } },
      hand: {
        queries: Object.fromEntries(
          mine.map((f, i) => [`.slot:nth-child(${String(i + 1)}) .card`, [f]]),
        ),
      },
      seatR2: {
        queries: Object.fromEntries(
          theirs.map((f, i) => [`.seat-cards .card:nth-child(${String(i + 1)})`, [f]]),
        ),
      },
    });
    paint(p.doc, app);
    expect(p.get('tableScreen').attr('data-dealt')).toBe(`${String(v.startedAt)}:1`);
    expect(clone.hasClass('flyer')).toBe(true);
    expect(clone.style('--fly-ms')).toBe('220ms');
    [...mine, ...theirs].forEach((f) => {
      expect(f.hasClass('arriving')).toBe(true);
      expect(f.attr('data-flying')).toBe('');
    });
    // A repaint of the dealt table (the curtain, a lift) launches nothing and keeps the cards under their clones.
    const flown = clone.style('transform');
    paint(p.doc, app);
    expect(clone.style('transform')).toBe(flown);
    expect(mine.every((f) => f.hasClass('arriving'))).toBe(true);
    clone.fire('transitionend');
    [...mine, ...theirs].forEach((f) => {
      expect(f.hasClass('arriving')).toBe(false);
      expect(f.attr('data-flying')).toBe(null);
    });
    // The first play: a trick is open, the deal is over; the latch stays on this game.
    const id = v.legal[0];
    if (id === undefined) throw new Error('nothing legal');
    const played = own(
      app,
      { type: 'curtain/reveal' },
      { type: 'card/tap', cardId: id },
      { type: 'card/tap', cardId: id },
    ).app;
    paint(p.doc, played);
    expect(view(played).trick).toHaveLength(1);
    expect(p.get('tableScreen').attr('data-dealt')).toBe(`${String(v.startedAt)}:1`);
    expect(mine.some((f) => f.hasClass('arriving'))).toBe(false);
  });

  test('a play flies (PR-D): the fan card`s clone leaves from the hand slot measured before the repaint and lands at its tilt; the same fan repainted flies nothing; a dragged card lands by its ghost', () => {
    const app = revealed(local());
    const v = view(app);
    const id = v.legal[0];
    if (id === undefined) throw new Error('nothing legal');
    const clone = fakeEl('clone', { classes: ['card', 'face', 'mid'] });
    const seat = String(v.me.idx);
    const fan = fakeEl('fan', { classes: ['card', 'face', 'mid'], attrs: { 'data-seat': seat } });
    Object.assign(fan.el, {
      getBoundingClientRect: () => ({ left: 300, top: 300, width: 56, height: 91 }),
      cloneNode: () => clone.el,
    });
    const slotCard = fakeEl('held', { classes: ['card', 'face'] });
    Object.assign(slotCard.el, {
      getBoundingClientRect: () => ({ left: 20, top: 600, width: 80, height: 130 }),
    });
    const p = briscolaPage(MARKUP, {
      hand: { queries: { [`.card[data-card="${id}"]`]: [slotCard] } },
      trick: { queries: { [`.card[data-seat="${seat}"]`]: [fan], '.card': [fan] } },
    });
    paint(p.doc, app);
    // The revealed hand: nothing has flown, the latch names the empty fan.
    expect(p.get('tableScreen').attr('data-flown')).toBe(`${String(v.startedAt)}:1:open:`);
    expect(clone.hasClass('flyer')).toBe(false);
    const played = playFirst(app);
    paint(p.doc, played);
    const laid = view(played).trick[0];
    if (laid === undefined) throw new Error('nothing laid');
    expect(p.get('tableScreen').attr('data-flown')).toBe(
      `${String(v.startedAt)}:1:open:${trickKey([laid])}`,
    );
    expect(clone.hasClass('flyer')).toBe(true);
    expect(clone.style('left')).toBe('20px');
    expect(clone.style('--fly-ms')).toBe('320ms');
    expect(fan.hasClass('arriving')).toBe(true);
    expect(fan.attr('data-flying')).toBe('');
    // A repaint of the same fan (a tip, a lift) keeps the card hidden under its clone and launches nothing.
    const flown = clone.style('transform');
    paint(p.doc, played);
    expect(fan.hasClass('arriving')).toBe(true);
    expect(clone.style('transform')).toBe(flown);
    clone.fire('transitionend');
    expect(fan.hasClass('arriving')).toBe(false);
    paint(p.doc, played);
    expect(fan.hasClass('arriving')).toBe(false);
    // A drag's release: the ghost lands the card, no flight leaves.
    const ghost = briscolaPage(MARKUP, {
      hand: { queries: { [`.card[data-card="${id}"]`]: [slotCard] } },
      trick: { queries: { [`.card[data-seat="${seat}"]`]: [fan], '.card': [fan] } },
    });
    slotCard.el.classList.add('dragging');
    const dragged = run(
      app,
      { type: 'card/dragStart', cardId: id },
      { type: 'card/dragOver', over: true },
      { type: 'card/dragEnd' },
    ).app;
    paint(ghost.doc, app);
    const before = clone.style('transform');
    paint(ghost.doc, dragged);
    expect(view(dragged).trick).toHaveLength(1);
    expect(clone.style('transform')).toBe(before);
  });

  test('the settle beat: the taker marked and the counts held through hold and fly, the stock through the draw, then the cold paint', () => {
    const p = page();
    const one = playFirst(revealed(local()));
    const holder = view(revealed(one));
    const two = playFirst(revealed(one));
    const settle = two.table.settle;
    if (settle === null) throw new Error('no settle');
    expect(settle.stage).toBe('follow');
    const trick = settle.trick;
    const v = view(two);
    expect(v.me.idx).toBe(holder.me.idx);
    const me = v.me.idx;
    const start = game(two).startedAt;
    paint(p.doc, two);
    // Follow: both cards on the table, the winner's `taking`, no fighters marked and the goldens' key
    // (the frame the beat opens on is the pinned one); the tallies as before the trick.
    expect(p.get('trick').attr('data-key')).toBe(`${trickKey(trick.cards)}|linea|it`);
    expect(p.get('trick').text()).toContain(' taking"');
    expect(p.get('trick').text()).not.toContain('winner');
    expect(p.get('trick').text()).not.toContain('loser');
    expect(p.get('trick').attr('data-stage')).toBe('follow');
    expect(p.get('trick').attr('data-pose')).toBeNull();
    expect(p.get('trick').text()).not.toContain('clash-fx');
    expect(p.get('trick').text()).toContain(`data-seat="${String(trick.winner)}"`);
    expect(p.get('statusText').text()).toBe(takesText(v.players, me, trick));
    expect(p.get('scoreStrip').attr('data-key')).toMatch(/^players\|0:0,0:0\|/);
    expect(p.get('myTaken').text()).toBe('You: 0');
    expect(p.get('stock').attr('data-count')).toBe('34');
    expect(p.get('stockCount').text()).toBe('Stock · 34');
    expect(v.stockCount).toBe(32);
    expect(p.get('tableScreen').attr('data-beat')).toBe(`${String(start)}:1:1:follow`);
    expect(p.get('hand').hasClass('inert')).toBe(true);
    expect(p.get('seatR2').hasClass('to-move')).toBe(false);
    // Held: no chip anywhere yet (the strips read as before the trick). A seat's strip is
    // `#myTricks` while the phone is in its hands, else the one cell across (`meNow` says whose).
    const chipsOf = (text: string): number => (text.match(/class="card back chip"/g) ?? []).length;
    const stripOf = (whose: Seat, meNow: Seat): string =>
      whose === meNow ? p.get('myTricks').text() : p.get('seatR2').text();
    const loser = ((trick.winner + 1) % 2) as Seat;
    const winnerStrip = (meNow: Seat = me): string => stripOf(trick.winner, meNow);
    const loserStrip = (meNow: Seat = me): string => stripOf(loser, meNow);
    expect(chipsOf(winnerStrip())).toBe(0);
    expect(chipsOf(loserStrip())).toBe(0);
    // Charge: the fighters marked and the variant's slots on the fan (the CSS animates from them);
    // the axis measured once as the charge opens (the fake measures nothing: the defaults).
    const charge = elapsed(two);
    paint(p.doc, charge);
    expect(charge.table.settle?.stage).toBe('charge');
    const c = charge.table.settle?.variant;
    if (c === undefined) throw new Error('no variant');
    expect(p.get('trick').attr('data-stage')).toBe('charge');
    expect(p.get('trick').attr('data-charge')).toBe(String(c.chargeDist));
    expect(p.get('trick').attr('data-angle')).toBe(String(c.chargeAngle));
    expect(p.get('trick').attr('data-sign')).toBe(c.chargeSign > 0 ? '+' : '-');
    expect(p.get('trick').attr('data-tempo')).toBe(c.tempo);
    expect(p.get('trick').attr('data-pose')).toBe(c.pose);
    expect(p.get('trick').attr('data-after')).toBe(c.after);
    expect(p.get('trick').attr('data-side')).toBe(c.side);
    expect(p.get('trick').attr('data-value')).toBe(c.valueClass);
    expect(p.get('trick').attr('data-shake')).toBe(String(c.shakePx));
    expect(p.get('trick').style('--charge-dist')).toBe(String(c.chargeDist));
    expect(p.get('trick').style('--lean')).toBe(`${String(c.chargeAngle * c.chargeSign)}deg`);
    expect(p.get('trick').style('--ux')).toBe('1');
    expect(p.get('trick').style('--cx')).toBe('50%');
    expect(p.get('trick').attr('data-key')).toBe(`${trickKey(trick.cards)}|linea|it|fight`);
    expect(p.get('trick').text()).toContain('class="play winner"');
    expect(p.get('trick').text()).toContain('class="play loser"');
    expect(p.get('trick').text()).not.toContain('bystander');
    expect(p.get('trick').text()).toContain(' taking"');
    // Impact: the winner `taking`, the frame of its suit at the contact point with its sparkles (a briscola's) or none.
    const impact = elapsed(elapsed(charge));
    paint(p.doc, impact);
    expect(impact.table.settle?.stage).toBe('impact');
    expect(p.get('trick').attr('data-key')).toBe(`${trickKey(trick.cards)}|linea|it|hit`);
    expect(p.get('trick').text()).toContain(' taking"');
    expect(p.get('trick').text()).toContain('class="play winner"');
    expect(p.get('trick').text()).toContain(
      `<div class="clash-fx" data-suit="${IMPACT_SUIT[c.suit]}" data-frame="${c.frame}" data-sparkle="${c.sparkle}" data-steal="${String(c.steal)}">`,
    );
    expect(p.get('trick').text()).toContain(`#impact-${IMPACT_SUIT[c.suit]}-${c.frame}`);
    expect(
      (
        p
          .get('trick')
          .text()
          .match(/class="sparkle"/g) ?? []
      ).length,
    ).toBe(c.sparkle === 'none' ? 0 : c.sparkle === 'ring' ? 6 : 8);
    // A repaint at the impact appends no second frame; the aftermath keeps it.
    paint(p.doc, impact);
    expect(
      (
        p
          .get('trick')
          .text()
          .match(/class="clash-fx"/g) ?? []
      ).length,
    ).toBe(1);
    const aftermath = elapsed(impact);
    paint(p.doc, aftermath);
    expect(aftermath.table.settle?.stage).toBe('aftermath');
    expect(
      (
        p
          .get('trick')
          .text()
          .match(/class="clash-fx"/g) ?? []
      ).length,
    ).toBe(1);
    // Fly (the pack): the frame gone, the fighters unmarked, the beat marked; the seats still hold
    // two cards; the winner's strip lays the one chip the cards fly to (its count 1, the loser's still 0).
    const fly = elapsed(aftermath);
    paint(p.doc, fly);
    expect(fly.table.settle?.stage).toBe('fly');
    expect(p.get('trick').attr('data-key')).toBe(`${trickKey(trick.cards)}|linea|it|pack`);
    expect(p.get('trick').text()).not.toContain('clash-fx');
    expect(p.get('trick').text()).not.toContain('winner');
    expect(p.get('trick').attr('data-pose')).toBeNull();
    expect(p.get('trick').text()).toContain(' taking"');
    expect(p.get('tableScreen').attr('data-beat')).toBe(`${String(start)}:1:1:fly`);
    expect(p.get('statusText').text()).toBe(takesText(v.players, me, trick));
    expect(chipsOf(winnerStrip())).toBe(1);
    expect(chipsOf(loserStrip())).toBe(0);
    if (trick.winner === me) {
      expect(p.get('myTricks').attr('data-count')).toBe('1');
      expect(p.get('myTricks').style('--n')).toBe('1');
      expect(p.get('myTricks').attr('data-key')).toBe('1|linea');
    } else {
      expect(p.get('seatR2').text()).toContain(
        '<span class="seat-taken" data-count="1" style="--n:1">',
      );
    }
    expect(
      (
        p
          .get('seatR2')
          .text()
          .match(/class="card back tiny"/g) ?? []
      ).length,
    ).toBe(2);
    // Draw: my draw waits for the tap ("Drawing… tap the stock", the stock tappable, my slot
    // pulsing round the hidden card), the tallies scored, the seats refilled, the stock still as
    // before the draw.
    const draw = elapsed(fly);
    paint(p.doc, draw);
    expect(draw.table.settle?.stage).toBe('draw');
    expect(awaitingDraw(draw.table.settle)).toBe(true);
    expect(p.get('statusText').text()).toBe(DRAW_TAP_STATUS);
    expect(p.get('tableScreen').attr('data-beat')).toBe(`${String(start)}:1:1:draw`);
    expect(p.get('stock').hasClass('tappable')).toBe(true);
    // Over declared slots: the drawn card's slot pulses (`awaiting`) round the hidden card; the others do not.
    const ids = view(draw).me.hand.map((c) => c.id);
    const drawnId = ids.find((id) => !holder.me.hand.some((h) => h.id === id));
    if (drawnId === undefined) throw new Error('no drawn card');
    const hp = declareHand(ids);
    paint(hp.page.doc, draw);
    hp.slots.forEach((slot, i) => {
      expect(slot.hasClass('awaiting')).toBe(ids[i] === drawnId);
    });
    expect(hp.cards.get(drawnId)?.hasClass('arriving')).toBe(true);
    expect(hp.cards.get(drawnId)?.hasClass('flipping')).toBe(false);
    // The timer's end is the wait: nothing changes until the tap.
    expect(elapsed(draw)).toBe(draw);
    // The tap: my back flies and the card turns over (`flipping`); the slot stops pulsing; the
    // card shows once its clone has landed (nothing flew over the fake, so at once).
    const mine = tapped(draw);
    paint(p.doc, mine);
    expect(mine.table.settle?.stage).toBe('drawMine');
    expect(p.get('statusText').text()).toBe(DRAWING_STATUS);
    expect(p.get('tableScreen').attr('data-beat')).toBe(`${String(start)}:1:1:drawMine`);
    expect(p.get('stock').hasClass('tappable')).toBe(false);
    paint(hp.page.doc, mine);
    hp.slots.forEach((slot) => {
      expect(slot.hasClass('awaiting')).toBe(false);
    });
    expect(hp.cards.get(drawnId)?.hasClass('flipping')).toBe(true);
    expect(hp.cards.get(drawnId)?.hasClass('arriving')).toBe(false);
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
    // The chip stays: the trick scored, the strip shows it (the same key as the flight laid).
    expect(chipsOf(winnerStrip())).toBe(1);
    expect(chipsOf(loserStrip())).toBe(0);
    // Cold: the stock thinned, the trick cleared for the winner's lead, the beat forgotten.
    const cold = settled(mine);
    expect(cold.table.settle).toBeNull();
    paint(p.doc, cold);
    expect(p.get('stock').attr('data-count')).toBe('32');
    expect(p.get('stockCount').text()).toBe('Stock · 32');
    expect(p.get('trick').text()).toBe('');
    expect(p.get('tableScreen').attr('data-beat')).toBeNull();
    // The phone has passed to the winner (or stayed): its strip keeps the chip wherever it paints.
    const meCold = view(cold).me.idx;
    expect(meCold).toBe(trick.winner);
    expect(chipsOf(winnerStrip(meCold))).toBe(1);
    expect(chipsOf(loserStrip(meCold))).toBe(0);
  });

  test('four players: three cells with their seats, the strip per player (no teams), the handoff not offered', () => {
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
    expect(p.get('scoreStrip').attr('data-mode')).toBe('players');
    expect(p.get('scoreStrip').text()).not.toContain('&amp;');
    ['Ann', 'Bob', 'Cara', 'Dan'].forEach((name) => {
      expect(p.get('scoreStrip').text()).toContain(`<span class="sc-name">${name}`);
    });
    expect(
      (
        p
          .get('scoreStrip')
          .text()
          .match(/class="score-cell/g) ?? []
      ).length,
    ).toBe(4);
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
    // The finished matches under the events (web/shared/ui/recentGames.ts): none yet; one line each once there are.
    expect(p.get('recentGames').text()).toBe('');
    const record: RecentGame = {
      at: NOW,
      mode: 'local',
      players: ['Ann', 'Bob', 'Cara', 'Dan'],
      score: '2–1',
      winner: 0,
      outcome: 'win',
    };
    paint(p.doc, { ...app, shell: { ...app.shell, recentGames: [record] } });
    expect(p.get('recentGames').text()).toBe(recentGamesHtml([record]).markup);
    expect(p.get('recentGames').text()).toContain('Ann · Bob · Cara · Dan');
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

describe('the game over and the result sheet', () => {
  test('the last trick: the stock out, the briscola gone; the result sheet once settled (the game decided, never the end screen), put away and back; Play again deals anew for the next dealer', () => {
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
    expect(p.get('hand').attr('data-key')).toBe(`${handKey(['AC', null, null], 'linea')}|it`);
    expect(p.get('statusText').text()).toBe('Your turn — play a card');
    // Ann leads the asso, Bob answers with the tre: the game is over once the beat has played.
    const over = settled(playFirst(revealed(playFirst(start))));
    const w = view(over);
    expect(w.phase).toBe('over');
    expect(w.matchOver).toBe(true);
    paint(p.doc, over);
    expect(shown(p)).toEqual(['tableScreen']);
    expect(p.get('endgameScreen').hidden()).toBe(true);
    expect(p.get('resultOverlay').hidden()).toBe(false);
    expect(p.get('rsTitle').text()).toBe('Ann wins the game');
    expect(p.get('rsSub').text()).toBe('120–0');
    expect(p.get('rsScore').text()).toBe(
      '<div class="score-row"><span class="who">Ann</span><span>120</span></div><div class="score-row"><span class="who">Bob</span><span>0</span></div>',
    );
    expect(p.get('rsReplayBtn').text()).toBe(PLAY_AGAIN_LABEL);
    expect(PLAY_AGAIN_LABEL).toBe('Play again');
    expect(p.get('rsReplayBtn').hasClass('btn-go')).toBe(true);
    expect(p.get('rsReplayBtn').disabled()).toBe(false);
    // The status line reads the game's result alone: no match clause, though the engine decided one.
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
    // Play again: a new deal, the sheet down, the stock full, the curtain up for the new leader.
    const next = run(over, { type: 'replay/click' }).app;
    paint(p.doc, next);
    expect(view(next).gameNo).toBe(1);
    expect(view(next).dealer).toBe((w.dealer + 1) % 2);
    expect(p.get('resultOverlay').hidden()).toBe(true);
    expect(p.get('stock').attr('data-count')).toBe('34');
    expect(p.get('scoreStrip').attr('data-key')).toMatch(/^players\|0:0,0:0\|/);
    expect(p.get('curtainOverlay').hidden()).toBe(false);
  });

  test('a guest`s Play again waits for the host to deal: the button reads so and is disabled', () => {
    const p = page();
    const over = settled(playFirst(revealed(playFirst(lastTrickPosition(local())))));
    const w = view(over);
    const asGuest: App = { ...over, shell: { ...over.shell, role: 'guest' } };
    expect(replayLabel(over, w)).toBe('Play again');
    expect(replayLabel(asGuest, w)).toBe('Waiting for Ann to deal');
    paint(p.doc, asGuest);
    expect(p.get('resultOverlay').hidden()).toBe(false);
    expect(p.get('rsReplayBtn').text()).toBe('Waiting for Ann to deal');
    expect(p.get('rsReplayBtn').disabled()).toBe(true);
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
    p.get('stock').fire('click');
    // The felt's tap (no card, no slot) and the stock's are the draw's tap (dropped by the reducer outside the wait).
    expect(r.intents).toEqual([
      { type: 'card/tap', cardId: '7D' },
      { type: 'draw/tap' },
      { type: 'card/tap', cardId: '7D' },
      { type: 'table/tap' },
      { type: 'exchange/click' },
      { type: 'draw/tap' },
    ]);
    expect(handIntentOf({ target: fakeTarget({}) } as unknown as Event)).toBeNull();
    // Disabled controls dispatch nothing; enabled ones their constant.
    p.get('playBtn').fire('click');
    expect(r.intents).toHaveLength(6);
    p.get('rsReplayBtn').fire('click');
    p.get('leaveBtn').fire('click');
    p.get('historyBtn').fire('click');
    p.get('rulesBtnGame').fire('click');
    p.get('soundBtn').fire('click');
    p.get('handoffBtn').fire('click');
    p.get('resultChipBtn').fire('click');
    expect(r.intents.slice(6)).toEqual([
      { type: 'replay/click' },
      { type: 'leave/request' },
      { type: 'history/open' },
      { type: 'rules/open' },
      { type: 'sound/toggle' },
      { type: 'handoff/click' },
      { type: 'result/open' },
    ]);
    // The sheets: a close button and a backdrop tap dispatch the sheet's intent; a tap inside does not.
    p.get('rsPeekBtn').fire('click');
    p.get('resultOverlay').fire('click', { target: fakeTarget({ id: 'resultOverlay' }) });
    p.get('resultOverlay').fire('click', { target: fakeTarget({ id: 'rsTitle' }) });
    p.get('closeHistoryBtn').fire('click');
    p.get('closeRulesBtn').fire('click');
    expect(r.intents.slice(13)).toEqual([
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

describe('card names (docs/design/language-packs.md §5): the captions, the tip and the card view', () => {
  const IT = langByName('it');
  const EN = langByName('en');

  test('every play wears its caption and the briscola its line under the stock, in the App`s language; a switch repaints them', () => {
    const start = revealed(local());
    const v = view(start);
    const p = page();
    paint(p.doc, start);
    expect(p.get('briscolaName').text()).toBe(cardNameOf(IT, v.trumpCard.id));
    expect(p.get('briscolaName').text()).toMatch(/ di /);
    const played = playFirst(start);
    const laid = view(played).trick[0];
    if (laid === undefined) throw new Error('nothing played');
    paint(p.doc, played);
    expect(p.get('trick').text()).toContain(
      `<span class="card-name">${cardNameOf(IT, laid.card.id)}</span>`,
    );
    expect(p.get('trick').text()).toContain(`aria-label="${cardNameOf(IT, laid.card.id)}"`);
    const english = run(played, { type: 'lang/set', name: 'en' }).app;
    paint(p.doc, english);
    expect(p.get('trick').attr('data-key')).toBe(`${trickKey([laid])}|linea|en`);
    expect(p.get('trick').text()).toContain(
      `<span class="card-name">${cardNameOf(EN, laid.card.id)}</span>`,
    );
    expect(p.get('briscolaName').text()).toMatch(/ of /);
    expect(p.get('briscola').attr('data-key')).toBe(`${v.trumpCard.id}|linea|en`);
    // The briscola drawn: no line under the stock.
    const last = lastTrickPosition(start);
    paint(p.doc, last);
    expect(p.get('briscola').hasClass('gone')).toBe(true);
    expect(p.get('briscolaName').text()).toBe('');
  });

  test('the tip: hidden until the timer shows it over a card the hand holds, placed at the card`s top centre, named in the language; hidden again on hide, under the curtain and without its card', () => {
    const start = revealed(local());
    const card = view(start).legal[0] ?? '';
    const { page: p, cards } = declareHand(view(start).me.hand.map((c) => c.id));
    paint(p.doc, start);
    expect(p.get('cardTip').hidden()).toBe(true);
    const armed = run(start, { type: 'tip/arm', card, press: false }).app;
    paint(p.doc, armed);
    expect(p.get('cardTip').hidden()).toBe(true);
    const shown = run(armed, { type: 'tip/show' }).app;
    paint(p.doc, shown);
    expect(p.get('cardTip').hidden()).toBe(false);
    expect(p.get('cardTip').text()).toBe(cardNameOf(IT, card));
    expect(p.get('cardTip').attr('data-card')).toBe(card);
    expect(cards.has(card)).toBe(true);
    // A fake measures as zeros: the tip lands at the card's rect (the CSS lifts it clear).
    expect(p.get('cardTip').style('left')).toBe('0px');
    expect(p.get('cardTip').style('top')).toBe('0px');
    paint(p.doc, run(shown, { type: 'lang/set', name: 'en' }).app);
    expect(p.get('cardTip').text()).toBe(cardNameOf(EN, card));
    paint(p.doc, run(shown, { type: 'tip/hide' }).app);
    expect(p.get('cardTip').hidden()).toBe(true);
    // Shown in the App but the card is not in the hand's markup (played away): hidden.
    const bare = page();
    paint(bare.doc, shown);
    expect(bare.get('cardTip').hidden()).toBe(true);
    // Under the curtain a shown tip is never painted (the hand is face down).
    const curtained: App = { ...shown, table: { ...shown.table, curtain: 0 } };
    paint(p.doc, curtained);
    expect(p.get('cardTip').hidden()).toBe(true);
  });

  test('the card view: the face keyed on the card, the pack and the language, its name beneath; closed, the sheet hides', () => {
    const start = revealed(local());
    const p = page();
    paint(p.doc, start);
    expect(p.get('cardViewOverlay').hidden()).toBe(true);
    const open = run(start, { type: 'cardView/open', card: 'RD' }).app;
    paint(p.doc, open);
    expect(p.get('cardViewOverlay').hidden()).toBe(false);
    expect(p.get('cardViewFace').attr('data-key')).toBe('RD|linea|it');
    expect(p.get('cardViewFace').text()).toContain('data-card="RD"');
    expect(p.get('cardViewFace').text()).toContain('aria-label="re di denari"');
    expect(p.get('cardViewName').text()).toBe('re di denari');
    paint(p.doc, run(open, { type: 'lang/set', name: 'en' }).app);
    expect(p.get('cardViewFace').attr('data-key')).toBe('RD|linea|en');
    expect(p.get('cardViewName').text()).toBe('king of coins');
    paint(p.doc, run(open, { type: 'cardView/close' }).app);
    expect(p.get('cardViewOverlay').hidden()).toBe(true);
  });

  test('bindTip: a fine pointer arms on over and drops on out or a press; a touch arms on down and drops on up with the click swallowed; nothing over a face-down hand; the sheet closes', () => {
    const card = fakeEl('card-7D', { attrs: { 'data-card': '7D' } });
    const p = briscolaPage(MARKUP, {}, [card]);
    const r = recorder();
    bindAll(p.doc, r.dispatch);
    // The live intent's hover half rides the same events (`bindHover`): this test reads the tip's alone.
    const tips = (): ReadonlyArray<unknown> => r.intents.filter((i) => i.type !== 'hover/set');
    const over = { target: fakeTarget({ closest: { '.card[data-card]': card } }) };
    p.get('hand').fire('pointerover', { ...over, pointerType: 'mouse' });
    p.get('hand').fire('pointerover', { ...over, pointerType: 'touch' });
    p.get('hand').fire('pointerover', { target: fakeTarget({ id: 'hand' }), pointerType: 'mouse' });
    p.get('hand').fire('pointerout', { pointerType: 'mouse' });
    p.get('hand').fire('pointerdown', { ...over, pointerType: 'mouse' });
    p.get('hand').fire('pointerdown', { ...over, pointerType: 'touch' });
    p.get('hand').fire('pointerup', { ...over, pointerType: 'touch' });
    p.get('hand').fire('pointerup', { ...over, pointerType: 'mouse' });
    p.get('hand').fire('pointercancel', { pointerType: 'touch' });
    expect(tips()).toEqual([
      { type: 'tip/arm', card: '7D', press: false },
      { type: 'tip/hide' },
      { type: 'tip/hide' },
      { type: 'tip/arm', card: '7D', press: true },
      { type: 'tip/hide', swallow: true },
      { type: 'tip/hide' },
      { type: 'tip/hide' },
    ]);
    // Face down (under the curtain): a hover or a press over a back arms nothing.
    p.get('hand').el.classList.add('hidden-cards');
    p.get('hand').fire('pointerover', { ...over, pointerType: 'mouse' });
    p.get('hand').fire('pointerdown', { ...over, pointerType: 'touch' });
    expect(tips().slice(7)).toEqual([{ type: 'tip/hide' }]);
    // The card view's close button and backdrop.
    p.get('closeCardViewBtn').fire('click');
    p.get('cardViewOverlay').fire('click', { target: fakeTarget({ id: 'cardViewOverlay' }) });
    p.get('cardViewOverlay').fire('click', { target: fakeTarget({ id: 'cardViewName' }) });
    expect(tips().slice(8)).toEqual([{ type: 'cardView/close' }, { type: 'cardView/close' }]);
  });
});

describe('the deck sheet', () => {
  /** The `data-card` ids of the chips whose class list ends in `mark` (` chip gone`, ` chip held`), in row order. */
  const chips = (p: BriscolaPage, mark: string): ReadonlyArray<string> =>
    [
      ...p
        .get('deckList')
        .text()
        .matchAll(/<div class="card [^"]*" data-card="([^"]+)"/g),
    ]
      .filter((m) => m[0].includes(`${mark}" data-card`))
      .map((m) => m[1] ?? '');

  test('shut until opened; open, the count line, the forty keyed on what is gone and the toggle; my hand greyed on the toggle; a lift rebuilds nothing; a trick taken does', () => {
    const p = page();
    const start = revealed(local());
    paint(p.doc, start);
    expect(p.get('deckOverlay').hidden()).toBe(true);
    expect(p.get('deckBtn').disabled()).toBe(false);
    const open = run(start, { type: 'deck/open' }).app;
    paint(p.doc, open);
    expect(p.get('deckOverlay').hidden()).toBe(false);
    const v = view(open);
    const deck = deckOf(v, false);
    expect(p.get('deckSub').text()).toBe(deckSubText(deck));
    expect(p.get('deckSub').text()).toBe('36 unseen · 34 in the stock');
    expect(p.get('deckList').attr('data-key')).toBe(`${deckKey(deck)}|linea`);
    expect(p.get('deckList').text().match(/ chip/g)).toHaveLength(40);
    expect(chips(p, ' chip gone')).toEqual([v.trumpCard.id]);
    expect(chips(p, ' chip held')).toEqual([]);
    expect(p.get('deckIncludeHand').checked()).toBe(false);
    // The toggle: my three greyed with the ring, the count line says so, the box follows the App.
    const withHand = run(open, { type: 'deck/toggleHand' }).app;
    paint(p.doc, withHand);
    expect(p.get('deckIncludeHand').checked()).toBe(true);
    expect(new Set(chips(p, ' chip held'))).toEqual(new Set(v.me.hand.map((card) => card.id)));
    expect(chips(p, ' chip gone')).toEqual([v.trumpCard.id]);
    expect(p.get('deckSub').text()).toBe('36 unseen · 34 in the stock · 3 in your hand');
    expect(p.get('deckList').attr('data-key')).toBe(`${deckKey(deckOf(v, true))}|linea`);
    // A lift changes no key; a trick taken greys its two cards.
    const key = p.get('deckList').attr('data-key');
    const lifted = run(withHand, { type: 'card/tap', cardId: v.legal[0] ?? '' }).app;
    paint(p.doc, lifted);
    expect(p.get('deckList').attr('data-key')).toBe(key);
    const taken = settled(playFirst(revealed(playFirst(withHand))));
    const after = run(taken, { type: 'deck/open' }).app;
    paint(p.doc, after);
    const trick = view(after).lastTrick?.cards.map((play) => play.card.id) ?? [];
    expect(trick).toHaveLength(2);
    expect(new Set(chips(p, ' chip gone'))).toEqual(new Set([...trick, view(after).trumpCard.id]));
    expect(p.get('deckSub').text()).toBe('34 unseen · 32 in the stock · 3 in your hand');
    // Closed: hidden, the list left as it was.
    paint(p.doc, run(after, { type: 'deck/close' }).app);
    expect(p.get('deckOverlay').hidden()).toBe(true);
  });

  test('bindAll: the button, the close, the backdrop and the toggle are the deck intents', () => {
    const p = page();
    const r = recorder();
    bindAll(p.doc, r.dispatch);
    p.get('deckBtn').fire('click');
    p.get('closeDeckBtn').fire('click');
    p.get('deckOverlay').fire('click', { target: fakeTarget({ id: 'deckOverlay' }) });
    p.get('deckOverlay').fire('click', { target: fakeTarget({ id: 'deckList' }) });
    p.get('deckIncludeHand').fire('change');
    expect(r.intents).toEqual([
      { type: 'deck/open' },
      { type: 'deck/close' },
      { type: 'deck/close' },
      { type: 'deck/toggleHand' },
    ]);
    // Escape with the sheet up is its close.
    p.get('deckOverlay').el.classList.remove('hidden');
    p.fire('keydown', { key: 'Escape' });
    expect(r.intents.at(-1)).toEqual({ type: 'deck/close' });
  });
});

describe('the live intent mirror (docs/design/briscola-battle.md §4.4): the painter and the hover binding', () => {
  test('paintSeats lifts the slot-th back of the seat by class, outside the cell`s key; a clear drops it', () => {
    const backs = [0, 1, 2].map((i) => fakeEl(`back-${String(i)}`));
    const p = briscolaPage(
      MARKUP,
      { seatR2: { queries: { '.seat-cards > .card': backs } } },
      backs,
    );
    const app = local();
    const other = view(app).others[0];
    if (other === undefined) throw new Error('no opponent');
    const mirrored = (mode: 'hover' | 'raised' | null, slot: 0 | 1 | 2 = 1): App => ({
      ...app,
      table: {
        ...app.table,
        mirror: [0, 1, 2, 3].map((s) => (s === other.idx && mode !== null ? { slot, mode } : null)),
      },
    });
    paint(p.doc, app);
    const key = p.get('seatR2').attr('data-key');
    expect(backs.map((b) => b.classes())).toEqual([[], [], []]);
    paint(p.doc, mirrored('hover'));
    expect(backs.map((b) => b.hasClass('intent-hover'))).toEqual([false, true, false]);
    expect(backs.map((b) => b.hasClass('intent-raised'))).toEqual([false, false, false]);
    paint(p.doc, mirrored('raised', 2));
    expect(backs.map((b) => b.hasClass('intent-hover'))).toEqual([false, false, false]);
    expect(backs.map((b) => b.hasClass('intent-raised'))).toEqual([false, false, true]);
    paint(p.doc, mirrored(null));
    expect(backs.map((b) => b.classes())).toEqual([[], [], []]);
    expect(p.get('seatR2').attr('data-key')).toBe(key);
  });

  test('bindHover: a fine pointer over a slot names its index and off the slots null, a touch names nothing, focus counts as a hover, a stray slot is off the three', () => {
    const { page: p, slots } = declareHand(['AC', '3C', 'RB']);
    const r = recorder();
    bindAll(p.doc, r.dispatch);
    const hovers = (): ReadonlyArray<unknown> => r.intents.filter((i) => i.type === 'hover/set');
    const at = (slot: FakeEl | undefined): Readonly<{ target: unknown }> => ({
      target: fakeTarget(slot === undefined ? { id: 'hand' } : { closest: { '.slot': slot } }),
    });
    p.get('hand').fire('pointerover', { ...at(slots[1]), pointerType: 'mouse' });
    p.get('hand').fire('pointerover', { ...at(slots[2]), pointerType: 'touch' });
    p.get('hand').fire('pointerover', { ...at(undefined), pointerType: 'pen' });
    p.get('hand').fire('pointerout', { ...at(slots[1]), pointerType: 'mouse' });
    p.get('hand').fire('pointerout', { ...at(slots[1]), pointerType: 'touch' });
    p.get('hand').fire('focusin', at(slots[2]));
    p.get('hand').fire('focusout', at(slots[2]));
    p.get('hand').fire('focusin', at(fakeEl('stray')));
    expect(hovers()).toEqual([
      { type: 'hover/set', slot: 1 },
      { type: 'hover/set', slot: null },
      { type: 'hover/set', slot: null },
      { type: 'hover/set', slot: 2 },
      { type: 'hover/set', slot: null },
      { type: 'hover/set', slot: null },
    ]);
  });
});

describe('the impact frame markup (docs/design/briscola-battle.md §3.5)', () => {
  test('the winning suit and A/B pick the symbol; a briscola brings its ring or scatter of sparkles at their offsets, none otherwise', () => {
    const asso = cardById('AS');
    const due = cardById('2C');
    if (asso === null || due === null) throw new Error('cards');
    const cards = [
      { seat: 0 as Seat, card: asso },
      { seat: 1 as Seat, card: due },
    ];
    // Spade led, the asso di spade wins, trump denari: no briscola, no sparkle.
    const plain = variantFrom(0, trickFacts('D', cards));
    expect(clashFxHtml(plain)).toBe(
      '<svg class="fx" viewBox="0 0 100 100" aria-hidden="true"><use href="#impact-spade-a"/></svg>',
    );
    // The same cards with spade as trump: a briscola win; digit d5 = 0 is the ring (6), 1 the scatter (8).
    const ring = variantFrom(0, trickFacts('S', cards));
    expect(ring.sparkle).toBe('ring');
    expect((clashFxHtml(ring).match(/class="sparkle"/g) ?? []).length).toBe(6);
    expect(clashFxHtml(ring)).toContain('style="--k:0;--sx:36;--sy:0"');
    const scatter = variantFrom(3 * 3 * 2 * 3 * 2, trickFacts('S', cards));
    expect(scatter.sparkle).toBe('scatter');
    expect((clashFxHtml(scatter).match(/class="sparkle"/g) ?? []).length).toBe(8);
    expect(clashFxHtml(scatter)).toContain('href="#sparkle"');
  });
});

describe('three and four seats online (docs/design/n-seat-sessions.md §7)', () => {
  const opts3 = { ...DEFAULT_OPTS, seatCount: 3 as const };
  const online: HomeSnapshot = { ...home, playMode: 'online' };
  const join = (name: string, seat: 1 | 2 | 3): Intent => ({
    type: 'host/frame',
    frame: { t: 'join', name },
    seat,
  });
  /** Ann's table of three, Bob at seat 1 and Cara at seat 2, dealt. */
  const dealt3 = (): App =>
    run(
      initialApp,
      { type: 'home/init', home: online },
      { type: 'host/click', name: 'Ann', players: '3' },
      join('Bob', 1),
      join('Cara', 2),
      { type: 'host/deal' },
    ).app;

  test('the waiting rooms list the seats: the host first, each guest seat by name or number, the viewer`s own marked; the guest`s list comes off the welcome', () => {
    const p = page();
    const room = run(
      initialApp,
      { type: 'home/init', home: online },
      { type: 'host/click', name: 'Ann', players: '3' },
      join('Bob', 1),
    ).app;
    paint(p.doc, room);
    expect(shown(p)).toEqual(['hostWaitScreen']);
    expect(p.get('seatList').text()).toBe(
      '<li data-seat="0" data-connected="true" data-you="">Ann · host · you</li><li data-seat="1" data-connected="true">Bob</li><li data-seat="2" data-connected="false">Seat 3 · empty</li>',
    );
    expect(p.get('hostWaitStatus').text()).toBe('Bob joined! Waiting for 1 more.');
    expect(p.get('startGameBtn').hidden()).toBe(true);
    // Every seat taken: Start shows; the list is rebuilt only when a seat changes (the keyed slot).
    const full = run(room, join('Cara', 2)).app;
    paint(p.doc, full);
    expect(p.get('startGameBtn').hidden()).toBe(false);
    expect(p.get('seatList').text()).toContain('<li data-seat="2" data-connected="true">Cara</li>');
    const key = p.get('seatList').attr('data-key');
    paint(p.doc, full);
    expect(p.get('seatList').attr('data-key')).toBe(key);
    // The guest at seat 2, its join not yet heard: the table off the welcome, its own row marked.
    const guest = run(
      initialApp,
      { type: 'home/init', home: online },
      { type: 'join/click', name: 'Cara', code: 'ABCD' },
      {
        type: 'guest/frame',
        frame: welcome(
          'Ann',
          opts3,
          [
            { name: 'Bob', connected: true },
            { name: null, connected: true },
          ],
          2,
        ),
      },
    ).app;
    paint(p.doc, guest);
    expect(shown(p)).toEqual(['guestWaitScreen']);
    expect(p.get('guestSeatList').text()).toBe(
      '<li data-seat="0" data-connected="true">Ann · host</li><li data-seat="1" data-connected="true">Bob</li><li data-seat="2" data-connected="true" data-you="">Seat 3 · you · empty</li>',
    );
    expect(p.get('guestWaitStatus').text()).toBe(
      'Connected — 3 of 3 seated · waiting for Ann to deal',
    );
  });

  test('at the table each seat`s dot and `gone` follow its own channel; a seat down pauses the trick (the hand inert, the status naming who is to reconnect); back, it resumes; a guest reads the host off the pair and the other seats as up', () => {
    const p = page();
    const app = dealt3();
    paint(p.doc, app);
    expect(p.get('seats').attr('data-players')).toBe('3');
    expect(p.get('seatR1').attr('data-seat')).toBe('1');
    expect(p.get('seatR3').attr('data-seat')).toBe('2');
    expect(p.get('seatR1').text()).toContain('conn-dot on');
    expect(p.get('seatR3').text()).toContain('conn-dot on');
    expect(p.get('seatR3').hasClass('gone')).toBe(false);
    const gone = run(app, { type: 'host/guestGone', iceFailed: null, seat: 2 }).app;
    paint(p.doc, gone);
    expect(p.get('seatR3').hasClass('gone')).toBe(true);
    expect(p.get('seatR3').text()).toContain('conn-dot off');
    expect(p.get('seatR1').hasClass('gone')).toBe(false);
    expect(p.get('seatR1').text()).toContain('conn-dot on');
    expect(p.get('statusText').text()).toBe('Waiting for Cara to reconnect…');
    expect(p.get('hand').hasClass('inert')).toBe(true);
    expect(seatConnected(gone, 1)).toBe(true);
    expect(seatConnected(gone, 2)).toBe(false);
    const back = run(gone, join('Cara', 2)).app;
    paint(p.doc, back);
    expect(p.get('seatR3').hasClass('gone')).toBe(false);
    expect(p.get('statusText').text()).not.toContain('reconnect');
    // A guest: the host's dot is the pair's, the other guests' channels are unknown to it, so up.
    const asGuest: App = {
      ...app,
      shell: { ...app.shell, role: 'guest', oppConnected: false, view: viewFor(game(app), 1) },
    };
    expect(seatConnected(asGuest, 0)).toBe(false);
    expect(seatConnected(asGuest, 2)).toBe(true);
    paint(p.doc, asGuest);
    expect(p.get('statusText').text()).not.toContain('reconnect');
  });

  test('the result sheet at four lists every seat by points, the winner first (a free-for-all, no teams); one row per seat', () => {
    const app = local({ localPlayers: '4', p3: 'Cara', p4: 'Dan' });
    const v = view(app);
    const totals = [30, 20, 50, 20];
    const over: View = {
      ...v,
      phase: 'over',
      sides: totals,
      result: { winner: 2, totals, draw: false },
    };
    expect(resultSheetText(over)).toEqual({
      title: 'Cara wins the game',
      sub: 'Cara 50 · Ann 30 · Bob 20 · Dan 20',
    });
    expect(sideRowsHtml(over)).toBe(
      '<div class="score-row"><span class="who">Ann</span><span>30</span></div><div class="score-row"><span class="who">Bob</span><span>20</span></div><div class="score-row"><span class="who">Cara</span><span>50</span></div><div class="score-row"><span class="who">Dan</span><span>20</span></div>',
    );
    expect(resultLine(over)).toBe('Cara wins 50–30–20–20');
  });
});
