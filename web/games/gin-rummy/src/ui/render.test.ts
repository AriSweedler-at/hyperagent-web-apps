// No jsdom here (docs/ARCHITECTURE.md "Testing pyramid"): the paint runs against the page fake
// built from the page's own markup (ui/page.fake.ts over web/games/gin-rummy/index.html), so every
// id, initial class and value is the real one. The views come from a seeded game the engine plays
// through `legalActions`; the strings are pinned where the legacy `render()` wrote them, and the
// DOM-snapshot oracle (tools/parity/gin-dom-parity.ts) is the whole-page check.
import { describe, expect, test } from 'vitest';

import { fakeEl, fakeTarget } from '../../../../shared/edge/page.fake.ts';
import type { RecentGame } from '../../../../shared/lib/recentGames.ts';
import { mulberry32 } from '../../../../shared/lib/rng.ts';
import { recentGamesHtml } from '../../../../shared/ui/recentGames.ts';
import {
  applyAction,
  createGame,
  legalActions,
  makeCard,
  makeDeck,
  viewFor,
  bestLayoffActions,
} from '../engine/index.ts';
import type { Action, Card, Rank, Seat, State, View } from '../engine/index.ts';
import { cardHtml, pretty } from './cards.ts';
import { slotHandView } from './hand/SlotHandView.ts';
import { ginPage, type GinPage } from './page.fake.ts';
import {
  paintHandoff,
  RULES_SLOT_IDS,
  actionsHtml,
  bindAll,
  connDotClass,
  continueLabel,
  deadwoodHtml,
  fmtTime,
  gameDurationText,
  hideToast,
  historyHtml,
  meldChooserSub,
  meldOptionHtml,
  oppCardsHtml,
  paint,
  paintScreen,
  paintSound,
  paintWaiting,
  renderAbout,
  renderRules,
  roundResultText,
  rulesItemsHtml,
  showToast,
  standingsHtml,
  type PageLike,
  discardsHtml,
  discardsSubText,
} from './render.ts';
import { state as stateFrame } from '../protocol.ts';
import { aboutHtml } from './about.ts';
import { RULES_ITEMS, RULES_LIST_HTML } from './rules.ts';
import {
  SCREENS,
  initialApp,
  reduce,
  type App,
  type Intent,
  type Shell,
  type Table,
} from './state.ts';

import MARKUP from '../../index.html?raw';

const page = (): GinPage => ginPage(MARKUP);
/** The whole paint with main.ts's hand view (the slot view with the ghost draw slot). */
const paintAll = (doc: PageLike, app: App): void => {
  paint(doc, app, slotHandView);
};

const NOW = 1_700_000_000_000;
const rng = mulberry32(3);
const PLAYERS = [
  { id: 'p1', name: 'Ann' },
  { id: 'p2', name: 'Bob' },
] as const;
const apply = (s: State, seat: Seat, a: Action): State => {
  const r = applyAction(s, seat, a, rng, () => NOW);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

/** The discard that leaves the least deadwood (the first on a tie). */
const bestDiscard = (v: View, legal: ReadonlyArray<Action>): Action | undefined => {
  const dw = (x: Action): number => {
    const o = 'cardId' in x ? v.discardOptions?.[x.cardId] : undefined;
    return o !== undefined && !('locked' in o) ? o.deadwood : Infinity;
  };
  return legal
    .filter((a) => a.type === 'discard')
    .reduce<Action | undefined>(
      (best, a) => (best === undefined || dw(a) < dw(best) ? a : best),
      undefined,
    );
};

/**
 * Knock when possible, else pass the upcard, draw from the stock, discard for the least deadwood;
 * between hands the seat that is not ready yet continues.
 */
/** A knock answered as the engine used to answer it by itself: the best layoffs, then finished (§7b). */
const settled = (s: State): State => bestLayoffActions(s).reduce((g, a) => apply(g, g.turn, a), s);

const playUntil = (s: State, stop: (s: State) => boolean, budget = 2000): State => {
  if (stop(s)) return s;
  if (budget === 0) throw new Error('the game never reached the state asked for');
  if (s.phase === 'layoff') return playUntil(settled(s), stop, budget - 1);
  const between = s.phase === 'roundOver' || s.phase === 'gameOver';
  const seat: Seat = between ? (s.ready[0] ? 1 : 0) : s.turn;
  const v = viewFor(s, seat);
  const legal = legalActions(v);
  const pick =
    legal.find((a) => a.type === 'knock') ??
    legal.find((a) => a.type === 'passUpcard') ??
    legal.find((a) => a.type === 'drawStock') ??
    bestDiscard(v, legal) ??
    legal[0];
  if (pick === undefined) throw new Error(`no legal action in ${s.phase}`);
  return playUntil(apply(s, seat, pick), stop, budget - 1);
};

/** Dealer 1, so seat 0 (Ann) is the non-dealer and moves first. */
const dealt = createGame({ players: PLAYERS, target: 100, dealer: 1 }, rng, () => NOW);
const passed = apply(apply(dealt, 0, { type: 'passUpcard' }), 1, { type: 'passUpcard' });
/** Seat 0 drew from the stock and must discard; that draw is final. */
const drawn = apply(passed, 0, { type: 'drawStock' });
/** Seat 0 took the upcard and must discard; that draw undoes. */
const taken = apply(dealt, 0, { type: 'takeUpcard' });
const knocked = playUntil(dealt, (s) => s.phase === 'roundOver' && s.result?.void === false);
/** A one-point game: the first scored hand ends it. */
const short = createGame({ players: PLAYERS, target: 1, dealer: 0 }, rng, () => NOW);
const over = playUntil(short, (s) => s.phase === 'gameOver');

/** Per-case overrides on the two halves of the App (state.ts `Shell`/`Table`). */
type Over = Readonly<{ shell?: Partial<Shell>; table?: Partial<Table> }>;
const local = (game: State, seat: Seat, over: Over = {}): App => ({
  ...initialApp,
  shell: {
    ...initialApp.shell,
    role: 'local',
    oppConnected: true,
    game,
    view: viewFor(game, seat),
    screen: 'tableScreen',
    ...over.shell,
  },
  table: { ...initialApp.table, ...over.table },
});

const shown = (p: GinPage): ReadonlyArray<string> => SCREENS.filter((id) => !p.get(id).hidden());

describe('renderAbout', () => {
  test('fills #aboutCopy with the two paragraphs, their jargon linked to the rules', () => {
    const p = page();
    renderAbout(p.doc);
    expect(p.get('aboutCopy').text()).toBe(aboutHtml());
    expect(p.get('aboutCopy').text().match(/<p>/g)).toHaveLength(2);
    expect(p.get('aboutCopy').text()).toContain('data-rule="knock">knocks</a>');
  });
});

describe('renderRules', () => {
  test('fills both slots with the eleven items, one per line, as ui/rules.ts has them', () => {
    const p = page();
    renderRules(p.doc);
    RULES_SLOT_IDS.forEach((id) => {
      expect(p.get(id).text()).toBe(rulesItemsHtml());
    });
    expect(rulesItemsHtml().split('\n')).toHaveLength(RULES_ITEMS.length);
    expect(`<ul class="rules-list">\n${rulesItemsHtml()}\n</ul>`).toBe(RULES_LIST_HTML);
  });
});

describe('screens, waiting statuses, toast and sound', () => {
  test('paintScreen shows exactly the app screen and locks the body for the table', () => {
    const p = page();
    expect(shown(p)).toEqual(['homeScreen']);
    paintScreen(p.doc, { ...initialApp, shell: { ...initialApp.shell, screen: 'tableScreen' } });
    expect(shown(p)).toEqual(['tableScreen']);
    expect(p.body.hasClass('fixed-screen')).toBe(true);
    paintScreen(p.doc, { ...initialApp, shell: { ...initialApp.shell, screen: 'scEndScreen' } });
    expect(shown(p)).toEqual(['scEndScreen']);
    expect(p.body.hasClass('fixed-screen')).toBe(false);
  });

  test('paintWaiting: the room code, both statuses with their pulse, the deal button', () => {
    const p = page();
    paintWaiting(p.doc, initialApp);
    expect(p.get('roomCode').text()).toBe('----');
    expect(p.get('hostWaitStatus').text()).toBe('Opening room…');
    expect(p.get('hostWaitStatus').hasClass('pulse')).toBe(true);
    expect(p.get('startGameBtn').hidden()).toBe(true);
    paintWaiting(p.doc, {
      ...initialApp,
      shell: {
        ...initialApp.shell,
        code: 'ABCD',
        hostStatus: { text: 'Jeff joined! Ready when you are.', pulse: true },
        guestStatus: { text: 'boom', pulse: false },
        startGameVisible: true,
      },
    });
    expect(p.get('roomCode').text()).toBe('ABCD');
    expect(p.get('hostWaitStatus').text()).toBe('Jeff joined! Ready when you are.');
    expect(p.get('guestWaitStatus').text()).toBe('boom');
    expect(p.get('guestWaitStatus').hasClass('pulse')).toBe(false);
    expect(p.get('startGameBtn').hidden()).toBe(false);
    expect(p.get('startGameBtn').hasClass('btn')).toBe(true);
  });

  test('showToast / hideToast write the text and flip the show class', () => {
    const p = page();
    showToast(p.doc, 'Connected directly');
    expect(p.get('toast').text()).toBe('Connected directly');
    expect(p.get('toast').hasClass('show')).toBe(true);
    hideToast(p.doc);
    expect(p.get('toast').hasClass('show')).toBe(false);
    expect(p.get('toast').text()).toBe('Connected directly');
  });

  test('paintSound: the glyph and the tooltip', () => {
    const p = page();
    paintSound(p.doc, false);
    expect(p.get('soundBtn').text()).toBe('🔇');
    expect(p.get('soundBtn').attr('title')).toBe('Sound & vibration off');
    paintSound(p.doc, true);
    expect(p.get('soundBtn').text()).toBe('🔊');
    expect(p.get('soundBtn').attr('title')).toBe('Sound & vibration on');
  });

  test('paintHandoff: the 🌐 shows for a pass-and-play game alone, its tooltip naming who hosts and who joins', () => {
    const p = page();
    paintHandoff(p.doc, local(dealt, 0));
    expect(p.get('handoffBtn').hidden()).toBe(false);
    expect(p.get('handoffBtn').attr('title')).toBe(
      `Continue online: ${PLAYERS[0].name} hosts, ${PLAYERS[1].name} joins by invite`,
    );
    paintHandoff(p.doc, local(dealt, 0, { shell: { role: 'host' } }));
    expect(p.get('handoffBtn').hidden()).toBe(true);
    paintHandoff(p.doc, { ...initialApp, shell: { ...initialApp.shell, role: 'local' } });
    expect(p.get('handoffBtn').hidden()).toBe(true);
  });

  test('a missing element is a programming error', () => {
    const p = page();
    expect(() => {
      paint({ ...p.doc, getElementById: () => null }, initialApp, slotHandView);
    }).toThrow('missing element #homeScreen');
  });
});

describe('the table', () => {
  test('without a view nothing of the table is touched; the result sheet is hidden (leaveGame)', () => {
    const p = page();
    p.get('roundResultOverlay').el.classList.remove('hidden');
    paintAll(p.doc, initialApp);
    expect(p.get('hand').text()).toBe('');
    expect(p.get('statusMain').text()).toBe('');
    expect(p.get('oppCards').text()).toBe('');
    expect(p.get('roundResultOverlay').hidden()).toBe(true);
  });

  test('the mover after a stock draw: strip, piles, status, hand, deadwood, actions, undo', () => {
    const p = page();
    const app = local(drawn, 0);
    const v = viewFor(drawn, 0);
    if (v.discardTop === null) throw new Error('the upcard is on the pile after the deal');
    paintAll(p.doc, app);
    expect(shown(p)).toEqual(['tableScreen']);
    expect(p.get('oppName').text()).toBe('Bob');
    expect(p.get('oppScore').text()).toBe('0 pts');
    expect(p.get('oppCards').text()).toBe(oppCardsHtml(10));
    expect(oppCardsHtml(12)).toBe(
      `${'<div class="card back tiny"></div>'.repeat(11)}<span class="opp-count">12</span>`,
    );
    expect(p.get('connDot').attr('class')).toBe('conn-dot on hidden');
    expect(
      connDotClass({
        ...initialApp,
        shell: { ...initialApp.shell, role: 'host', oppConnected: false },
      }),
    ).toBe('conn-dot off');
    expect(p.get('connDot').attr('title')).toBe('Connected');
    expect(p.get('roundBadge').text()).toBe('Hand 1');
    expect(p.get('targetBadge').text()).toBe('to 100');
    // Piles: rebuilt once per key, the label refreshed every time.
    expect(p.get('stockPile').attr('data-key')).toBe('back');
    expect(p.get('stockPile').text()).toBe(
      '<div class="card back big"></div><div class="pile-label"></div>',
    );
    expect(p.stockLabel.text()).toBe('Stock · 30');
    expect(p.get('discardPile').attr('data-key')).toBe(v.discardTop.id);
    expect(p.get('discardPile').text()).toBe(
      `${cardHtml(v.discardTop, { big: true })}<div class="pile-label"></div>`,
    );
    expect(p.discardLabel.text()).toBe('Discard');
    // One pile size: no phase class on the table screen.
    expect(p.get('tableScreen').classes()).toEqual([]);
    // The card back preset rides on the body for theme.css.
    expect(p.body.attr('data-card-back')).toBe('default');
    expect(p.get('stockPile').hasClass('tappable')).toBe(false);
    // Status and hand: the eleven accepted cards in slots, no ghost cell (a game resumed mid-draw).
    expect(p.get('statusMain').text()).toBe('Your turn');
    expect(p.get('statusSub').text()).toBe('Tap a card to select it');
    expect(p.get('statusBanner').hasClass('mine')).toBe(true);
    expect(p.get('lastAction').text()).toBe(v.lastAction?.text);
    expect(p.get('myName').text()).toBe('Ann · 0 pts');
    expect(p.get('deadwoodInfo').text()).toBe(deadwoodHtml(v, null).markup);
    expect(p.get('deadwoodInfo').text()).toMatch(/^Best possible deadwood: \d+/);
    expect(p.get('hand').text()).toBe(slotHandView.render(v, null, null));
    expect(
      p
        .get('hand')
        .text()
        .match(/<div class="slot /g),
    ).toHaveLength(11);
    expect(p.get('hand').text()).not.toContain('ghost');
    expect(p.get('hand').hasClass('active')).toBe(true);
    // A stock draw is final: no undo button, the short labels (docs/design/gin-arrangement-and-
    // discards.md §4).
    expect(v.canUndo).toBe(false);
    expect(p.get('actions').text()).toBe(
      '<button class="btn btn-secondary grow" data-act="discard" disabled>Discard</button><button class="btn btn-gold grow" data-act="knock" disabled>Knock</button>',
    );
    expect(p.get('roundResultOverlay').hidden()).toBe(true);
    expect(p.get('meldOverlay').hidden()).toBe(true);
    // A selection: the status, the readout, the buttons.
    const selected = v.me.hand.find((c) => v.discardOptions?.[c.id] !== undefined)?.id ?? null;
    paintAll(p.doc, { ...app, table: { ...app.table, selectedCard: selected } });
    expect(p.get('statusSub').text()).toBe('Discard it, or knock if you can');
    expect(p.get('deadwoodInfo').text()).toMatch(/^Deadwood after discard: \d+/);
    expect(p.get('actions').text()).toContain('data-act="discard" >Discard</button>');
    expect(p.get('actions').text()).toMatch(/>Knock <small>\(\d+\)<\/small><\/button>$/);
    expect(p.get('hand').text()).toContain(' selected"');
    // A draw from the discard pile can be taken back: the undo button leads the actions row.
    const upcard = viewFor(taken, 0);
    expect(upcard.canUndo).toBe(true);
    paintAll(p.doc, local(taken, 0));
    expect(p.get('actions').text()).toBe(
      '<button class="btn btn-ghost" data-act="undoDraw" title="Undo draw">↩</button><button class="btn btn-secondary grow" data-act="discard" disabled>Discard</button><button class="btn btn-gold grow" data-act="knock" disabled>Knock</button>',
    );
    // A gin selection labels the knock button GIN!.
    const gin: View = {
      ...v,
      discardOptions: { [selected ?? '']: { deadwood: 0, canKnock: true, isGin: true } },
    };
    expect(actionsHtml(gin, selected).markup).toContain(
      '<button class="btn btn-gold grow" data-act="knock" >GIN! <small>(0)</small></button>',
    );
  });

  test('a dragged card that may be discarded lights the discard pile; over it the pile turns green; nothing without a drag', () => {
    const p = page();
    const v = viewFor(drawn, 0);
    const cardId = v.me.hand[0]?.id ?? '';
    paintAll(p.doc, local(drawn, 0, { table: { drag: { cardId, from: 'hand', onto: null } } }));
    expect(p.get('discardPile').hasClass('drop-ready')).toBe(true);
    expect(p.get('discardPile').hasClass('drop')).toBe(false);
    paintAll(
      p.doc,
      local(drawn, 0, { table: { drag: { cardId, from: 'hand', onto: 'discard' } } }),
    );
    expect(p.get('discardPile').hasClass('drop')).toBe(true);
    // The card just taken from the pile lights nothing; nor does a hand with no card in the air.
    const lockedView = { ...v, drawnFromDiscard: cardId };
    paintAll(
      p.doc,
      local(drawn, 0, {
        shell: { view: lockedView },
        table: { drag: { cardId, from: 'hand', onto: 'discard' } },
      }),
    );
    expect(p.get('discardPile').hasClass('drop-ready')).toBe(false);
    expect(p.get('discardPile').hasClass('drop')).toBe(false);
    paintAll(p.doc, local(drawn, 0));
    expect(p.get('discardPile').hasClass('drop-ready')).toBe(false);
  });

  test('the ghost draw slot: the drawn card shown over the held ten, its status, the pending cell', () => {
    const p = page();
    const before = viewFor(passed, 0);
    const shownApp = reduce(local(passed, 0), { type: 'stock/tap' }, { rng, now: () => NOW }).app;
    const v = shownApp.shell.view;
    if (v === null || shownApp.table.draw === null) throw new Error('the draw did not show');
    paintAll(p.doc, shownApp);
    expect(p.get('statusSub').text()).toBe('Tap the new card to keep it, or pick a discard');
    expect(p.get('hand').text()).toBe(
      slotHandView.render(v, null, shownApp.table.draw, shownApp.table.picture),
    );
    // The ten held cards paint as they were before the draw; the eleventh sits in the ghost cell.
    expect(
      p
        .get('hand')
        .text()
        .startsWith(
          slotHandView.render(before, null).slice(0, -'<div class="slot ghost open"></div>'.length),
        ),
    ).toBe(true);
    expect(p.get('hand').text()).toMatch(
      /<div class="slot ghost shown"><div class="card (red|black) fresh" data-card="[^"]+">.*<\/div><\/div>$/,
    );
    expect(
      p
        .get('hand')
        .text()
        .match(/data-card=/g),
    ).toHaveLength(11);
    // A stock draw is final: no undo button while it sits in the ghost cell either.
    expect(p.get('actions').text()).not.toContain('data-act="undoDraw"');
    expect(p.get('actions').text()).toContain('data-act="discard" disabled');
    // A guest awaiting the host's state frame: the pending cell and "Drawing…".
    const pending = local(passed, 0, { table: { draw: { kind: 'waiting', from: 'stock' } } });
    paintAll(p.doc, pending);
    expect(p.get('statusSub').text()).toBe('Drawing…');
    expect(p.get('hand').text()).toContain('<div class="slot ghost pending"></div>');
  });

  test('the first turn: the upcard buttons, the open ghost cell; the waiting note on the other side', () => {
    const p = page();
    const v = viewFor(dealt, 0);
    if (v.discardTop === null) throw new Error('the upcard is on the pile after the deal');
    paintAll(p.doc, local(dealt, 0));
    expect(p.get('tableScreen').classes()).toEqual([]);
    expect(p.get('discardPile').hasClass('tappable')).toBe(true);
    expect(p.get('statusSub').text()).toBe('Take the upcard or pass');
    expect(p.get('actions').text()).toBe(
      `<button class="btn btn-secondary grow" data-act="passUpcard">Pass</button><button class="btn btn-primary grow" data-act="takeUpcard">Take ${pretty(v.discardTop)}</button>`,
    );
    expect(p.get('hand').text()).toBe(slotHandView.render(v, null));
    expect(p.get('hand').text().endsWith('<div class="slot ghost open"></div>')).toBe(true);
    paintAll(p.doc, {
      ...local(dealt, 1),
      shell: { ...local(dealt, 1).shell, role: 'host', oppName: 'Ann' },
    });
    expect(p.get('hand').text().endsWith('<div class="slot ghost"></div>')).toBe(true);
    expect(p.get('statusMain').text()).toBe("Ann's turn");
    expect(p.get('statusSub').text()).toBe('Deciding on the upcard…');
    expect(p.get('statusBanner').hasClass('mine')).toBe(false);
    expect(p.get('actions').text()).toBe('<div class="waiting-note">Waiting for Ann…</div>');
    expect(p.get('connDot').attr('class')).toBe('conn-dot on');
    // Both passed: the stock is the only draw, the discard pile is blocked.
    paintAll(p.doc, local(passed, 0));
    expect(p.get('stockPile').hasClass('tappable')).toBe(true);
    expect(p.get('discardPile').hasClass('tappable')).toBe(false);
    expect(p.get('discardPile').hasClass('blocked')).toBe(true);
    expect(p.get('statusSub').text()).toBe('Both passed — tap the stock to draw');
    expect(p.get('actions').text()).toBe('<div class="waiting-note"></div>');
    expect(actionsHtml({ ...v, discardTop: null }, null).markup).toContain('Take upcard');
  });

  test('the result sheet names the cards laid off, from both seats (the chain position)', () => {
    // Alice AS 2S 3S 4H 5H 6H 7D 8D 9D 2C KC knocks with the KC; Bob 4S 5S 10H JH QH 7C 8C 9C QD KD
    // lays 4S then 5S onto the spades and counts QD KD (test/parity/gin.legacy.test.ts).
    const card = (id: string): Card => {
      const rank = { A: 1, J: 11, Q: 12, K: 13 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
      const suit = id.slice(-1);
      if (suit !== 'S' && suit !== 'H' && suit !== 'D' && suit !== 'C') throw new Error(id);
      return makeCard(rank as Rank, suit);
    };
    const alice = 'AS 2S 3S 4H 5H 6H 7D 8D 9D 2C KC'.split(' ').map(card);
    const bob = '4S 5S 10H JH QH 7C 8C 9C QD KD'.split(' ').map(card);
    const held = new Set([...alice, ...bob].map((c) => c.id));
    const rest = makeDeck().filter((c) => !held.has(c.id));
    const position: State = {
      ...drawn,
      players: [
        { id: 'p1', name: 'Alice', total: 0 },
        { id: 'p2', name: 'Bob', total: 0 },
      ],
      hands: [alice, bob],
      discard: rest.slice(0, 1),
      stock: rest.slice(1),
      turn: 0,
      phase: 'discard',
      drawnFromDiscard: null,
      pendingDraw: null,
      meldPref: [null, null],
    };
    const knockedOn = settled(apply(position, 0, { type: 'knock', cardId: 'KC' }));
    const result = knockedOn.result;
    if (result === null || result.void) throw new Error('the knock did not score');
    expect(result.opponent.laidOff.map((x) => x.card.id)).toEqual(['4S', '5S']);
    const laid = `<div class="rr-label">Laid off onto Alice's melds</div><div class="meld-group laid">${cardHtml(card('4S'), { mini: true })}${cardHtml(card('5S'), { mini: true })}</div>`;
    const dead = `<div class="rr-label">Deadwood · 20</div><div class="meld-group dead">${cardHtml(card('QD'), { mini: true })}${cardHtml(card('KD'), { mini: true })}</div>`;
    ([0, 1] as const).forEach((seat) => {
      const p = page();
      paintAll(p.doc, local(knockedOn, seat));
      expect(p.get('roundResultOverlay').hidden(), `seat ${String(seat)}`).toBe(false);
      expect(p.get('rrTitle').text()).toBe('Alice knocked');
      expect(p.get('rrBody').text()).toContain(laid);
      expect(p.get('rrBody').text()).toContain(dead);
      expect(p.get('rrBody').text()).toContain('<span>Alice <small>(knocked)</small></span>');
      expect(p.get('rrBody').text()).toMatch(/<div class="rr-label">Deadwood · 2<\/div>/);
    });
  });

  test('a knock: the result sheet, its texts and its continue button; dismissed hides it', () => {
    const p = page();
    const v = viewFor(knocked, 0);
    paintAll(p.doc, local(knocked, 0));
    expect(p.get('statusMain').text()).toBe('Hand over');
    expect(p.get('statusSub').text()).toBe('See results');
    expect(p.get('statusBanner').hasClass('mine')).toBe(false);
    expect(p.get('actions').text()).toBe(
      '<button class="btn btn-primary grow" data-act="showResult">Show results</button>',
    );
    expect(p.get('roundResultOverlay').hidden()).toBe(false);
    const text = roundResultText(v);
    expect(text).not.toBeNull();
    expect(p.get('rrTitle').text()).toBe(text?.title);
    expect(p.get('rrSub').text()).toBe(text?.sub);
    expect(p.get('rrBody').text()).toBe(text?.body.markup);
    // The body is built once per result and seat (its melds lay themselves out on first paint):
    // the key names the hand, the result and the seat, and a repaint of the same leaves it.
    const ts = v.result?.void === false ? v.result.ts : 0;
    const key = `${String(v.handNumber)}:${String(ts)}:0`;
    expect(p.get('rrBody').attr('data-key')).toBe(key);
    paintAll(p.doc, local(knocked, 0));
    expect(p.get('rrBody').attr('data-key')).toBe(key);
    paintAll(p.doc, local(knocked, 1));
    expect(p.get('rrBody').attr('data-key')).toBe(`${String(v.handNumber)}:${String(ts)}:1`);
    expect(p.get('rrBody').text()).toBe(roundResultText(viewFor(knocked, 1))?.body.markup);
    expect(p.get('rrTitle').text()).toMatch(/^(Ann|Bob) (knocked|went Gin!)$|undercut/);
    expect(p.get('rrSub').text()).toMatch(/ · ⏱ 0s$/);
    expect(p.get('rrBody').text()).toContain('<small>(knocked)</small>');
    expect(p.get('rrBody').text()).toMatch(
      /<div class="rr-totals"><span>Ann <strong>\d+<\/strong><\/span><span>Bob <strong>\d+<\/strong><\/span><\/div>$/,
    );
    expect(p.get('rrContinueBtn').text()).toBe('Next hand');
    expect(p.get('rrContinueBtn').disabled()).toBe(false);
    expect(continueLabel({ ...v, ready: [true, false] })).toBe('Waiting for Bob…');
    expect(continueLabel({ ...v, target: 1 })).toBe('See final result');
    paintAll(p.doc, local(knocked, 0, { table: { resultDismissed: true } }));
    expect(p.get('roundResultOverlay').hidden()).toBe(true);
    // A void hand has its own texts; a view without a result writes nothing.
    const voided = roundResultText({
      ...v,
      result: { void: true, ts: NOW, totals: [0, 0] },
      rounds: [],
    });
    expect(voided).toEqual({
      title: 'Hand void',
      sub: 'Only two cards were left in the stock. No points — same dealer redeals. · ⏱ 0s',
      body: { kind: 'safe-html', markup: '' },
    });
    expect(roundResultText({ ...v, result: null })).toBeNull();
    const gin = roundResultText({
      ...v,
      result: v.result?.void === false ? { ...v.result, outcome: 'gin', knockerIdx: 1 } : null,
    });
    expect(gin?.title).toBe('Bob went Gin!');
    expect(gin?.sub).toMatch(/^\+25 bonus \+ Ann's \d+ deadwood · ⏱ 0s$/);
    const undercut = roundResultText({
      ...v,
      result: v.result?.void === false ? { ...v.result, outcome: 'undercut' } : null,
    });
    expect(undercut?.title).toMatch(/undercut/);
    expect(undercut?.sub).toMatch(/→ difference \+ 25 bonus · ⏱ 0s$/);
  });

  test('the meld chooser paints while open, the legacy template whitespace included', () => {
    const p = page();
    const v = viewFor(drawn, 0);
    const optA = {
      melds: [v.me.hand.slice(0, 3)],
      deadwood: v.me.hand.slice(3, 5),
      value: 7,
      sig: 'a',
    };
    const optB = { melds: [v.me.hand.slice(1, 4)], deadwood: [], value: 0, sig: 'b' };
    const twoWays: View = { ...v, meldOptions: [optA, optB], activeMeldSig: 'a' };
    paintAll(p.doc, local(drawn, 0, { shell: { view: twoWays }, table: { meldChooser: true } }));
    expect(p.get('meldOverlay').hidden()).toBe(false);
    expect(p.get('meldSub').text()).toBe(meldChooserSub(twoWays));
    expect(p.get('meldSub').text()).toMatch(
      /^2 ways to meld for the same \d+ deadwood\. Your score is identical either way — but the melds you declare decide what Bob can lay off if you knock\.$/,
    );
    expect(p.get('meldOptionList').text()).toBe(
      meldOptionHtml(optA, 0, true) + meldOptionHtml(optB, 1, false),
    );
    expect(meldOptionHtml(optA, 0, true)).toContain(
      '<span>Option 1 <small>(in use)</small></span><span class="rr-pts">7</span>',
    );
    expect(meldOptionHtml(optB, 1, false)).toContain(
      `<div class="empty-note" style="text-align:left;">No deadwood — that's gin!</div>`,
    );
    expect(meldOptionHtml(optB, 1, false)).toContain(
      '<button class="btn btn-primary btn-block btn-sm" data-meld-opt="1" style="margin-top:8px;">Use this arrangement</button>',
    );
    expect(p.get('deadwoodInfo').text()).toContain('<span class="alt-badge">⇄ 2 ways</span>');
    expect(p.get('deadwoodInfo').hasClass('tappable-dw')).toBe(true);
    expect(p.get('deadwoodInfo').attr('title')).toBe('Tap to choose which melds you declare');
    paintAll(p.doc, local(drawn, 0));
    expect(p.get('meldOverlay').hidden()).toBe(true);
    expect(p.get('deadwoodInfo').attr('title')).toBe('');
  });

  test('gameOver: the endgame screen; the result sheet is left as it was', () => {
    const p = page();
    const v = viewFor(over, 0);
    paintAll(p.doc, local(over, 0));
    // The screen switch is the reducer's; the paint writes the endgame texts.
    expect(shown(p)).toEqual(['tableScreen']);
    const w = v.players[v.winner ?? 0];
    expect(p.get('endgameTitle').text()).toBe(`${w.name} wins! 🎉`);
    expect(p.get('endgameSub').text()).toBe(`Reached ${String(w.total)} points (target 1)`);
    expect(p.get('finalStandings').text()).toBe(standingsHtml(v).markup);
    expect(p.get('finalStandings').text()).toMatch(
      /^<div class="standing-row winner"><div class="standing-rank">#1<\/div><div class="standing-name">👑 (Ann|Bob)<\/div><div class="standing-total">\d+<\/div><\/div><div class="standing-row "><div class="standing-rank">#2<\/div>/,
    );
    expect(p.get('gameDuration').text()).toBe(gameDurationText(v));
    expect(p.get('gameDuration').text()).toBe(`0s · ${String(over.rounds.length)} hands`);
    expect(gameDurationText({ ...v, rounds: [] })).toBe('—');
    expect(p.get('rematchBtn').text()).toBe('Rematch');
    expect(p.get('rematchBtn').disabled()).toBe(false);
    paintAll(p.doc, local(over, 0, { shell: { view: { ...v, ready: [true, false] } } }));
    expect(p.get('rematchBtn').text()).toBe('Waiting for Bob…');
    expect(p.get('rematchBtn').disabled()).toBe(true);
    // The sheet stays up over the endgame until "Look at the table".
    p.get('roundResultOverlay').el.classList.remove('hidden');
    paintAll(p.doc, local(over, 0));
    expect(p.get('roundResultOverlay').hidden()).toBe(false);
    paintAll(p.doc, local(over, 0, { table: { resultDismissed: true } }));
    expect(p.get('roundResultOverlay').hidden()).toBe(true);
    // The table itself was not repainted.
    expect(p.get('hand').text()).toBe('');
  });

  test('gameOver: a Rematch never brings a put-away sheet back (host and guest)', () => {
    const ctx = { rng, now: () => NOW };
    // Host: "Look at the table", then Rematch. The engine keeps gameOver with ready [true, false]
    // and the reducer clears resultDismissed, as the legacy act(ready) did; the legacy render()
    // returned at gameOver before its overlay write, so the sheet stayed hidden.
    const p = page();
    const host: App = {
      ...local(over, 0),
      shell: { ...local(over, 0).shell, role: 'host', code: 'ABCD' },
    };
    const hidden = reduce(host, { type: 'result/hide' }, ctx).app;
    paintAll(p.doc, hidden);
    expect(p.get('roundResultOverlay').hidden()).toBe(true);
    const readied = reduce(hidden, { type: 'act', action: { type: 'ready' } }, ctx).app;
    expect(readied.shell.view?.phase).toBe('gameOver');
    expect(readied.shell.view?.ready).toEqual([true, false]);
    expect(readied.table.resultDismissed).toBe(false);
    paintAll(p.doc, readied);
    expect(p.get('roundResultOverlay').hidden()).toBe(true);
    // Guest: the host's state frame after its Rematch arrives while the sheet is put away.
    const q = page();
    const guest: App = {
      ...initialApp,
      shell: {
        ...initialApp.shell,
        role: 'guest',
        code: 'ABCD',
        oppConnected: true,
        view: viewFor(over, 1),
        screen: 'endgameScreen',
      },
    };
    const gHidden = reduce(guest, { type: 'result/hide' }, ctx).app;
    paintAll(q.doc, gHidden);
    expect(q.get('roundResultOverlay').hidden()).toBe(true);
    if (readied.shell.game === null) throw new Error('the host lost its game');
    const frame = stateFrame(viewFor(readied.shell.game, 1));
    const received = reduce(gHidden, { type: 'guest/frame', frame }, ctx).app;
    expect(received.shell.view?.ready).toEqual([true, false]);
    expect(received.table.resultDismissed).toBe(false);
    paintAll(q.doc, received);
    expect(q.get('roundResultOverlay').hidden()).toBe(true);
  });

  test('the rules and history overlays follow the App; the game history lists every hand', () => {
    const p = page();
    paintAll(p.doc, local(knocked, 0, { shell: { rulesOpen: true }, table: { history: 'game' } }));
    expect(p.get('rulesOverlay').hidden()).toBe(false);
    expect(p.get('historyOverlay').hidden()).toBe(false);
    const v = viewFor(knocked, 0);
    const list = p.get('historyList').text();
    expect(list).toBe(historyHtml(v).markup);
    expect(list.match(/<div class="history-round">/g)).toHaveLength(knocked.rounds.length);
    // The last row is the scored hand; any before it were void.
    const scored = String(knocked.rounds.length);
    expect(list).toMatch(
      new RegExp(
        `<div class="history-round"><div class="history-meta"><div class="history-scores"><strong>H${scored}</strong> — (Ann|Bob) (knocked|went Gin|undercut)[^<]*</div><div class="history-scores">Ann: \\+?\\d+ · Bob: \\+?\\d+</div><div class="history-time">${fmtTime(NOW)} · took 0s</div></div></div><div id="historyTotalTime">⏱ Time played: 0s</div>$`,
      ),
    );
    expect(historyHtml(null).markup).toBe('<div class="empty-note">No hands finished yet.</div>');
    expect(historyHtml(viewFor(drawn, 0)).markup).toBe(
      '<div class="empty-note">No hands finished yet.</div>',
    );
    const voidRound = historyHtml({
      ...v,
      rounds: [{ handNumber: 2, ts: NOW + 61_000, void: true, scores: { p1: 0, p2: 0 } }],
    }).markup;
    expect(voidRound).toContain('<strong>H2</strong> — void (stock ran out)</div>');
    expect(voidRound).toContain('· took 1m 1s</div>');
    const undercut = historyHtml({
      ...v,
      rounds: [
        {
          handNumber: 1,
          ts: NOW,
          knockerIdx: 0,
          outcome: 'undercut',
          deadwood: { p1: 8, p2: 5 },
          scores: { p1: 0, p2: 28 },
        },
        {
          handNumber: 2,
          ts: NOW,
          knockerIdx: 1,
          outcome: 'gin',
          deadwood: { p1: 40, p2: 0 },
          scores: { p1: 0, p2: 65 },
        },
      ],
    }).markup;
    expect(undercut).toContain('<strong>H1</strong> — Bob undercut Ann (5 vs 8)</div>');
    expect(undercut).toContain('<div class="history-scores">Ann: 0 · Bob: +28</div>');
    expect(undercut).toContain('<strong>H2</strong> — Bob went Gin</div>');
    // The Score Counter writes its own list: the paint leaves it alone.
    paintAll(p.doc, local(knocked, 0, { table: { history: 'scorer' } }));
    expect(p.get('historyOverlay').hidden()).toBe(false);
    expect(p.get('historyList').text()).toBe(historyHtml(v).markup);
    // The finished games under the hands (web/shared/ui/recentGames.ts): none yet, so the slot is
    // empty; with records, one line each under the game's history, none under the Score Counter's.
    expect(p.get('recentGames').text()).toBe('');
    const record: RecentGame = {
      at: NOW,
      mode: 'local',
      players: ['Ann', 'Bob'],
      score: '104–87',
      winner: 0,
      outcome: 'win',
    };
    paintAll(
      p.doc,
      local(knocked, 0, { shell: { recentGames: [record] }, table: { history: 'game' } }),
    );
    expect(p.get('recentGames').text()).toBe(recentGamesHtml([record]).markup);
    expect(p.get('recentGames').text()).toContain('<span class="recent-game-score">104–87</span>');
    paintAll(
      p.doc,
      local(knocked, 0, { shell: { recentGames: [record] }, table: { history: 'scorer' } }),
    );
    expect(p.get('recentGames').text()).toBe('');
    paintAll(p.doc, local(knocked, 0));
    expect(p.get('rulesOverlay').hidden()).toBe(true);
    expect(p.get('historyOverlay').hidden()).toBe(true);
  });
});

describe('bindAll', () => {
  const wired = (): Readonly<{ p: GinPage; intents: Intent[] }> => {
    const p = page();
    const intents: Intent[] = [];
    bindAll(p.doc, (i) => {
      intents.push(i);
    });
    return { p, intents };
  };

  test('the table controls dispatch their intents', () => {
    const { p, intents } = wired();
    const card = fakeEl('card', { attrs: { 'data-card': 'AS' } });
    const optBtn = fakeEl('opt', { attrs: { 'data-meld-opt': '1' } });
    const actBtn = fakeEl('act', { attrs: { 'data-act': 'knock' } });
    const undoBtn = fakeEl('undo', { attrs: { 'data-act': 'undoDraw' } });
    const disabledBtn = fakeEl('dis', { attrs: { 'data-act': 'discard', disabled: '' } });
    p.get('stockPile').fire('click');
    p.get('discardPile').fire('click');
    p.get('hand').fire('click', { target: fakeTarget({ closest: { '.card': card } }) });
    p.get('hand').fire('click');
    p.get('soundBtn').fire('click');
    // The undo button is a data-act in the actions row, delegated like the others.
    p.get('actions').fire('click', {
      target: fakeTarget({ closest: { 'button[data-act]': undoBtn } }),
    });
    p.get('deadwoodInfo').fire('click');
    p.get('discardsBtn').fire('click');
    p.get('arrangeBtn').fire('click');
    p.get('closeMeldBtn').fire('click');
    p.get('meldOverlay').fire('click', { target: fakeTarget({ id: 'meldOverlay' }) });
    p.get('meldOverlay').fire('click', { target: fakeTarget({ id: 'sheet' }) });
    p.get('meldOptionList').fire('click', {
      target: fakeTarget({ closest: { '[data-meld-opt]': optBtn } }),
    });
    p.get('meldOptionList').fire('click');
    p.get('actions').fire('click', {
      target: fakeTarget({ closest: { 'button[data-act]': actBtn } }),
    });
    p.get('actions').fire('click', {
      target: fakeTarget({ closest: { 'button[data-act]': disabledBtn } }),
    });
    p.get('actions').fire('click');
    p.get('rrContinueBtn').fire('click');
    p.get('rrHideBtn').fire('click');
    p.get('rematchBtn').fire('click');
    p.get('leaveBtn').fire('click');
    p.get('leaveBtnEnd').fire('click');
    p.get('handoffBtn').fire('click');
    p.get('rulesBtnGame').fire('click');
    p.get('closeRulesBtn').fire('click');
    p.get('historyBtn').fire('click');
    p.get('historyBtnEnd').fire('click');
    p.get('closeHistoryBtn').fire('click');
    p.get('rulesOverlay').fire('click', { target: fakeTarget({ id: 'rulesOverlay' }) });
    p.get('rulesOverlay').fire('click', { target: fakeTarget({ id: 'x' }) });
    p.get('historyOverlay').fire('click', { target: fakeTarget({ id: 'historyOverlay' }) });
    p.get('historyOverlay').fire('click', { target: fakeTarget({ id: 'x' }) });
    expect(intents).toEqual([
      { type: 'stock/tap' },
      { type: 'discard/tap' },
      { type: 'card/tap', cardId: 'AS' },
      { type: 'sound/toggle' },
      { type: 'action/click', act: 'undoDraw' },
      { type: 'meld/open' },
      { type: 'discards/open' },
      { type: 'arrange/open' },
      { type: 'meld/close' },
      { type: 'meld/close' },
      { type: 'meld/choose', index: 1 },
      { type: 'action/click', act: 'knock' },
      { type: 'act', action: { type: 'ready' } },
      { type: 'result/hide' },
      { type: 'act', action: { type: 'ready' } },
      { type: 'leave/request' },
      { type: 'leave/request' },
      { type: 'handoff/click' },
      { type: 'rules/open' },
      { type: 'rules/close' },
      { type: 'history/open', who: 'game' },
      { type: 'history/open', who: 'game' },
      { type: 'history/close' },
      { type: 'rules/close' },
      { type: 'history/close' },
    ]);
  });

  test('a press on a card and its release; a press between the cards is nothing', () => {
    const { p, intents } = wired();
    const card = fakeEl('card', { attrs: { 'data-card': 'AS' } });
    p.get('hand').fire('pointerdown');
    expect(intents).toEqual([]);
    p.get('hand').fire('pointerdown', { target: fakeTarget({ closest: { '.card': card } }) });
    p.get('hand').fire('pointerup');
    p.get('hand').fire('pointerleave');
    p.get('hand').fire('pointercancel');
    expect(intents).toEqual([
      { type: 'card/press', cardId: 'AS' },
      { type: 'card/release' },
      { type: 'card/release' },
      { type: 'card/release' },
    ]);
  });
});

describe('discardsHtml', () => {
  const v = viewFor(drawn, 0);
  const html = (withHand: boolean): string => discardsHtml(v, withHand).markup;

  test('52 chips in four suit rows, spades to clubs, ace to king; the pile greyed, its top ringed', () => {
    const chips = [
      ...html(false).matchAll(/<span class="dc([^"]*)" data-card="([^"]+)">([^<]+)<\/span>/g),
    ];
    expect(chips).toHaveLength(52);
    expect(chips.slice(0, 3).map((m) => m[2])).toEqual(['AS', '2S', '3S']);
    expect(chips.at(-1)?.[2]).toBe('KC');
    expect(chips.map((m) => m[3]).slice(9, 13)).toEqual(['10', 'J', 'Q', 'K']);
    expect(html(false).match(/<div class="dc-row (black|red)">/g)).toEqual([
      '<div class="dc-row black">',
      '<div class="dc-row red">',
      '<div class="dc-row red">',
      '<div class="dc-row black">',
    ]);
    const seen = chips.filter((m) => (m[1] ?? '').includes(' seen')).map((m) => m[2]);
    expect(new Set(seen)).toEqual(new Set(v.discardIds));
    expect(chips.filter((m) => (m[1] ?? '').includes(' top')).map((m) => m[2])).toEqual([
      v.discardTop?.id,
    ]);
    expect(html(false)).not.toContain(' held');
  });

  test('with the hand included, my cards are held; a view without discardIds greys nothing', () => {
    const held = [
      ...html(true).matchAll(/<span class="dc[^"]* held[^"]*" data-card="([^"]+)">/g),
    ].map((m) => m[1]);
    expect(new Set(held)).toEqual(new Set(v.me.hand.map((c) => c.id)));
    expect(discardsSubText(v, false)).toBe(`${String(v.discardIds?.length ?? 0)} of 52 discarded`);
    expect(discardsSubText(v, true)).toBe(
      `${String(v.discardIds?.length ?? 0)} of 52 discarded · 11 in your hand`,
    );
    // A legacy host's frame: the key is absent, not undefined.
    const legacy = Object.fromEntries(
      Object.entries(v).filter(([k]) => k !== 'discardIds'),
    ) as View;
    expect(discardsHtml(legacy, false).markup).not.toContain(' seen');
    expect(discardsSubText(legacy, false)).toBe('0 of 52 discarded');
  });
});
