// String goldens for the gin ui/ helpers (docs/MIGRATION.md step 11): each typed helper runs
// beside its legacy cut (test/fixtures/legacy/gin-ui.cjs, the page's own functions over a stub of
// the free variables they read) on the same inputs, and the strings must match character for
// character: every card in every option combination, meld groups, the whole hand markup over
// seeded views and selections, the status and deadwood readouts, the sound-cue sequence of whole
// games in both roles, and the rules list against both legacy copies. The legacy `fitTable` loop
// had a golden here (`fitScale`) until docs/design/gin-draw-ghost-slot.md PR B retired the
// measure-and-shrink table fit for CSS bounds; the cut's `fitTable` is not called.
import { describe, expect, test } from 'vitest';

import * as engine from '../../web/games/gin-rummy/src/engine/index.ts';
import type { Seat, State, View } from '../../web/games/gin-rummy/src/engine/index.ts';
import { backHtml, cardHtml, type CardOptions } from '../../web/games/gin-rummy/src/ui/cards.ts';
import {
  INITIAL_CUES,
  deadwoodText,
  fmtDuration,
  nextCue,
  selectionIn,
  statusFor,
  type Cue,
  type CueRole,
  type CueState,
} from '../../web/games/gin-rummy/src/ui/cues.ts';
import { meldGroupsHtml } from '../../web/games/gin-rummy/src/ui/hand/meldGroups.ts';
import { RULES_ITEMS, RULES_LIST_HTML } from '../../web/games/gin-rummy/src/ui/rules.ts';
import { mulberry32 } from '../../web/shared/lib/rng.ts';
import { loadLegacyGin, type GinState } from './gin.api.ts';
import { legacyRulesBlocks, loadLegacyGinUi, type LegacyApp } from './gin.fixtures.ts';
import { actor, policy } from './gin.policy.ts';

const legacy = loadLegacyGin();
const app: LegacyApp = { selectedCard: null, role: 'host' };
const fired: string[] = [];
const CUES: ReadonlyArray<Cue> = ['yourTurn', 'knockGood', 'gin', 'bad', 'neutral', 'win', 'lose'];
const fx = Object.fromEntries(
  CUES.map((cue) => [
    cue,
    () => {
      fired.push(cue);
    },
  ]),
);
/** No page: the helpers under test read no element (the cut's `fitTable`, which did, is not called). */
const ui = loadLegacyGinUi({
  engine: legacy,
  app,
  fx,
  $: () => null,
  document: { getElementById: () => null },
  toast: () => undefined,
  state: null,
});

const PLAYERS = [
  { id: 'host', name: 'Ann' },
  { id: 'guest', name: 'Jeff' },
] as const;
/** A stepping clock: the cue machine keys each round on its `ts`, so rounds must not share one. */
const clock = { t: 1_700_000_000_000 };
const now = (): number => {
  clock.t += 1000;
  return clock.t;
};
const viaJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Every view of one seeded game on the current engine, both seats, in order. */
const gameViews = (seed: number): ReadonlyArray<readonly [View, View]> => {
  const rng = mulberry32(seed);
  const choices = mulberry32(seed * 7919);
  const step = (
    state: State,
    acc: ReadonlyArray<readonly [View, View]>,
  ): ReadonlyArray<readonly [View, View]> => {
    const views = [engine.viewFor(state, 0), engine.viewFor(state, 1)] as const;
    const all = [...acc, views];
    if (state.phase === 'gameOver' || all.length > 5000) return all;
    const seat = actor(state as unknown as GinState) as Seat;
    const view = views[seat];
    const action = policy(
      choices,
      viaJson(view) as never,
      viaJson(engine.legalActions(view)) as never,
    );
    const r = engine.applyAction(state, seat, action, rng, now);
    if (!r.ok) throw new Error(r.error);
    // RULE CHANGE (§7b): a knock opens the layoff phase, which the legacy UI never rendered; the
    // best layoffs are played and finished at once, so the views compared are the legacy's.
    const next = engine.bestLayoffActions(r.value).reduce((s, a) => {
      const done = engine.applyAction(s, s.turn, a, rng, now);
      if (!done.ok) throw new Error(done.error);
      return done.value;
    }, r.value);
    return step(next, all);
  };
  return step(
    engine.createGame({ players: PLAYERS, target: 100, dealer: (seed % 2) as Seat }, rng, now),
    [],
  );
};
/** Seeds 21 and 23 reach a gin; the rest cover knocks, undercuts and void hands. */
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 21, 23];
const games = SEEDS.map(gameViews);
const allViews: ReadonlyArray<View> = games.flatMap((g) => g.flatMap(([a, b]) => [a, b]));

describe('cardHtml / backHtml', () => {
  const deck = engine.makeDeck();
  const flags = ['mini', 'big', 'selected', 'dim', 'fresh', 'locked'] as const;
  const combos: ReadonlyArray<CardOptions> = Array.from({ length: 64 }, (_, bits) =>
    Object.fromEntries(flags.filter((_, i) => (bits >> i) & 1).map((f) => [f, true])),
  );

  test('every card in every option combination is the legacy string', () => {
    deck.forEach((card) => {
      combos.forEach((opts) => {
        expect(cardHtml(card, opts)).toBe(ui.cardHtml(card, opts));
      });
      expect(cardHtml(card)).toBe(ui.cardHtml(card));
      expect(cardHtml(card, { mini: false, big: false })).toBe(
        ui.cardHtml(card, { mini: false, big: false }),
      );
    });
    expect(deck).toHaveLength(52);
  });

  test('card backs', () => {
    ['', 'tiny', 'big'].forEach((cls) => {
      expect(backHtml(cls)).toBe(ui.backHtml(cls));
    });
    expect(backHtml()).toBe(ui.backHtml());
    expect(backHtml()).toBe(ui.backHtml(undefined));
  });
});

describe('meldGroupsHtml', () => {
  test('over every melding of every seeded view, mini and full size, with and without extra', () => {
    const meldSets = allViews.flatMap((v) => [v.me.melds, ...v.meldOptions.map((o) => o.melds)]);
    expect(meldSets.some((m) => m.length >= 3)).toBe(true);
    meldSets.forEach((melds) => {
      expect(meldGroupsHtml(melds, '', true)).toBe(ui.meldGroupsHtml(melds, '', true));
      expect(meldGroupsHtml(melds)).toBe(ui.meldGroupsHtml(melds));
      expect(meldGroupsHtml(melds, '<i>x</i>', false)).toBe(
        ui.meldGroupsHtml(melds, '<i>x</i>', false),
      );
    });
  });
});

/** The selections the legacy render could hold for a view: none, each hand card, the drawn card. */
const selectionsFor = (view: View): ReadonlyArray<string | null> => [
  null,
  ...view.me.hand.map((c) => c.id),
];

describe('statusFor / deadwoodText', () => {
  test('equal the legacy readouts over every seeded view and selection', () => {
    allViews
      .filter((v) => v.phase !== 'gameOver')
      .forEach((view) => {
        selectionsFor(view).forEach((selection) => {
          app.selectedCard = selection;
          const { status, sub } = ui.legacyStatus(view);
          expect(statusFor(view, selection)).toEqual({ main: status, sub });
          // render() drops a selection that is not in the hand before the deadwood readout.
          expect(deadwoodText(view, selectionIn(view, selection))).toBe(
            ui.legacyDeadwoodText(view),
          );
        });
        // A stale selection (a card no longer in the hand) reads as no selection for the deadwood.
        app.selectedCard = null;
        expect(deadwoodText(view, selectionIn(view, 'ZZ'))).toBe(ui.legacyDeadwoodText(view));
      });
    expect(new Set(allViews.map((v) => statusFor(v, null).sub)).size).toBeGreaterThanOrEqual(7);
  });
});

describe('nextCue', () => {
  const runLegacy = (
    views: ReadonlyArray<View>,
    role: LegacyApp['role'],
  ): ReadonlyArray<string> => {
    app.role = role;
    ui.cueState.key = null;
    ui.cueState.turnKey = null;
    fired.length = 0;
    return views.flatMap((v) => {
      const before = fired.length;
      ui.playCuesFor(v);
      return fired.slice(before).length === 0 ? ['-'] : fired.slice(before);
    });
  };
  const runCurrent = (views: ReadonlyArray<View>, role: CueRole): ReadonlyArray<string> =>
    views.reduce<{ state: CueState; out: ReadonlyArray<string> }>(
      (acc, v) => {
        const { state, cue } = nextCue(acc.state, v, role);
        return { state, out: [...acc.out, cue ?? '-'] };
      },
      { state: INITIAL_CUES, out: [] },
    ).out;

  test('fires the legacy cue sequence for a host, a guest and pass-and-play over whole games', () => {
    games.forEach((game) => {
      const asHost = game.map(([a]) => a);
      const asGuest = game.map(([, b]) => b);
      // Pass-and-play renders the mover's view each turn, seat 0 after the hand.
      const asLocal = game.map(([a, b]) => {
        const s = a.phase === 'roundOver' || a.phase === 'gameOver' ? a : a.isMyTurn ? a : b;
        return s;
      });
      expect(runCurrent(asHost, 'online')).toEqual(runLegacy(asHost, 'host'));
      expect(runCurrent(asGuest, 'online')).toEqual(runLegacy(asGuest, 'guest'));
      expect(runCurrent(asLocal, 'local')).toEqual(runLegacy(asLocal, 'local'));
    });
    const everything = new Set(
      games.flatMap((g) =>
        runCurrent(
          g.map(([a]) => a),
          'online',
        ),
      ),
    );
    expect([...everything].sort()).toEqual(['-', ...CUES].sort());
  });
});

describe('fmtDuration', () => {
  test('equals the legacy over seeded and edge durations', () => {
    const rng = mulberry32(5);
    const samples = [
      -5000,
      0,
      999,
      1000,
      59_999,
      60_000,
      3_599_999,
      3_600_000,
      86_400_000,
      ...Array.from({ length: 300 }, () => Math.floor(rng() * 10_000_000)),
    ];
    samples.forEach((ms) => {
      expect(fmtDuration(ms)).toBe(ui.fmtDuration(ms));
    });
  });
});

describe('rules', () => {
  const trimmed = (block: string): ReadonlyArray<string> =>
    block
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '');

  test('RULES_LIST_HTML is both legacy copies, line for line, without the page indentation', () => {
    const blocks = legacyRulesBlocks();
    expect(blocks).toHaveLength(2);
    blocks.forEach((block) => {
      expect(RULES_LIST_HTML.split('\n')).toEqual(trimmed(block));
    });
    expect(RULES_ITEMS).toHaveLength(11);
  });
});
