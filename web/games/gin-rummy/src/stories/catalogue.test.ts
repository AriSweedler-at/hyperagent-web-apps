// The catalogue against the paint (docs/design/gin-draw-ghost-slot.md §8): every story paints on
// the page fake built from the page's own markup, and the facts the catalogue derived from the
// engine and the picture are read back out of the painted strings (the slot and card counts, the
// ghost cell's class, the fresh, locked, selected and hand-made cards, the phone rows, the Arrange
// button, the sort mode, the piles' classes, the buttons and their state, the status line, the
// open sheet). The `sameHandAs` pairs must hold the same card in each of the first ten slots, as
// the picture orders them and as the paint wrote them. No jsdom (docs/ARCHITECTURE.md "Testing
// pyramid"); e2e/gin-stories.spec.ts repeats the facts against the served DOM.
import { describe, expect, test } from 'vitest';

import { fakeEl, type FakeEl } from '../../../../shared/edge/page.fake.ts';
import { slotHandView } from '../ui/hand/SlotHandView.ts';
import { ginPage, type GinPage } from '../ui/page.fake.ts';
import { paint } from '../ui/render.ts';
import {
  KNOCK_SEED,
  SEED,
  STORIES,
  TWO_WAYS_SEED,
  heldCards,
  storyById,
  type GhostState,
  type SheetState,
  type Story,
  type StoryFacts,
} from './catalogue.ts';

import MARKUP from '../../index.html?raw';

type Painted = Readonly<{
  page: GinPage;
  modes: ReadonlyArray<FakeEl>;
  /** `#tableMelds .meld-group`: three groups declared for the paint's query (the knock positions have three melds). */
  groups: ReadonlyArray<FakeEl>;
}>;

/** The story painted on the page fake; the arrange sheet's mode buttons and the table's meld groups are declared for the paint's queries. */
const painted = (story: Story): Painted => {
  const modes = ['suit', 'rank', 'manual'].map((m) =>
    fakeEl(`mode-${m}`, { classes: ['btn'], attrs: { 'data-sort': m } }),
  );
  const groups = [0, 1, 2].map((i) =>
    fakeEl(`table-meld-${String(i)}`, {
      classes: ['meld-group', `m${String(i)}`, 'locked'],
      attrs: { 'data-onto': String(i) },
    }),
  );
  const page = ginPage(MARKUP, {
    arrangeModes: { queries: { 'button[data-sort]': modes } },
    tableMelds: { queries: { '.meld-group': groups } },
  });
  paint(page.doc, story.app, slotHandView);
  return { page, modes, groups };
};
const hand = (story: Story): string => painted(story).page.get('hand').text();

const KEBAB = /^[a-z]+(?:-[a-z]+)*$/;
const CARD = /<div class="card ([^"]*)" data-card="([^"]+)">/g;
const SLOT = /<div class="slot ([^"]*)">(?:<div class="card [^"]*" data-card="([^"]+)">)?/g;
const BUTTON = /<button [^>]*data-act="([^"]+)"([^>]*)>/g;

/** `(classes, id)` of every card in `#hand`, in order. */
const cards = (html: string): ReadonlyArray<readonly [ReadonlyArray<string>, string]> =>
  [...html.matchAll(CARD)].map((m) => [(m[1] ?? '').split(' '), m[2] ?? ''] as const);

/** The one card carrying `flag`, or null; two would be a paint bug. */
const flagged = (html: string, flag: string): string | null => {
  const ids = cards(html)
    .filter(([classes]) => classes.includes(flag))
    .map(([, id]) => id);
  expect(ids.length, `${flag} cards`).toBeLessThanOrEqual(1);
  return ids[0] ?? null;
};

/** `(slot classes, card id)` per slot, in order (null for the ghost cell without a card). */
const slots = (html: string): ReadonlyArray<readonly [ReadonlyArray<string>, string | null]> =>
  [...html.matchAll(SLOT)].map((m) => [(m[1] ?? '').split(' '), m[2] ?? null] as const);
const slotCards = (html: string): ReadonlyArray<string | null> => slots(html).map(([, id]) => id);

/** The ghost cell's class as painted: `none` without a cell, `hidden` for the bare cell. */
const ghostOnPage = (html: string): GhostState => {
  const cell = /<div class="slot ghost( open| pending| shown)?">/.exec(html);
  if (cell === null) return 'none';
  const kind = (cell[1] ?? '').trim();
  return kind === 'open' || kind === 'pending' || kind === 'shown' ? kind : 'hidden';
};

/** The one overlay not hidden, by id, or `none`. */
const sheetOnPage = (page: GinPage): SheetState =>
  !page.get('meldOverlay').hidden()
    ? 'meldOverlay'
    : !page.get('arrangeOverlay').hidden()
      ? 'arrangeOverlay'
      : !page.get('discardsOverlay').hidden()
        ? 'discardsOverlay'
        : !page.get('roundResultOverlay').hidden()
          ? 'roundResultOverlay'
          : 'none';

const CHIP = /<span class="dc([^"]*)" data-card="([^"]+)">/g;
/** The discarded-cards sheet as painted: the chips with `flag`, in the grid's (deck) order. */
const chipsOnPage = (page: GinPage, flag: string): ReadonlyArray<string> =>
  [...page.get('discardsGrid').text().matchAll(CHIP)]
    .filter((m) => (m[1] ?? '').split(' ').includes(flag))
    .map((m) => m[2] ?? '');

/** The ids of the mini cards under the result sheet's "Laid off onto" label (the deadwood label follows). */
const laidOffOnPage = (page: GinPage): ReadonlyArray<string> => {
  const laid = /<div class="meld-group laid">(.*?)<\/div><div class="rr-label">/.exec(
    page.get('rrBody').text(),
  );
  return [...(laid?.[1] ?? '').matchAll(CARD)].map((m) => m[2] ?? '');
};

/** `#tableMelds` as painted: each group's card ids and the laid-off ones, while the knock is answered. */
const layoffOnPage = (page: GinPage, groups: ReadonlyArray<FakeEl>): Partial<StoryFacts> => {
  if (page.get('tableMelds').hidden()) return {};
  const melds = groups.map((g) => cards(g.text()).map(([, id]) => id));
  const laid = groups.flatMap((g) =>
    cards(g.text())
      .filter(([classes]) => classes.includes('laid'))
      .map(([, id]) => id),
  );
  return { layoff: { melds, laid } };
};

/** The facts as the painted page shows them, in the catalogue's terms. */
const factsOnPage = ({ page, modes, groups }: Painted): StoryFacts => {
  const html = page.get('hand').text();
  const stock = page.get('stockPile');
  const disc = page.get('discardPile');
  const sheet = sheetOnPage(page);
  const arrange = page.get('arrangeBtn');
  const active = modes.filter((b) => b.hasClass('active'));
  expect(active.length, 'active sort modes').toBe(1);
  const sort = active[0]?.attr('data-sort');
  return {
    slots: slots(html).length,
    handCards: cards(html).length,
    ghost: ghostOnPage(html),
    freshId: flagged(html, 'fresh'),
    lockedId: flagged(html, 'locked'),
    selectedId: flagged(html, 'selected'),
    human: slots(html).flatMap(([classes, id]) =>
      classes.includes('human') && id !== null ? [id] : [],
    ),
    rows: Number(page.get('hand').attr('data-rows')),
    arrange: arrange.disabled() ? 'off' : arrange.hasClass('due') ? 'due' : 'idle',
    sort: sort === 'rank' || sort === 'manual' ? sort : 'suit',
    stock: stock.hasClass('tappable') ? 'tappable' : 'idle',
    discard: disc.hasClass('tappable') ? 'tappable' : disc.hasClass('blocked') ? 'blocked' : 'idle',
    actions: [...page.get('actions').text().matchAll(BUTTON)].map((m) => ({
      act: m[1] ?? '',
      enabled: !/\bdisabled\b/.test(m[2] ?? ''),
    })),
    statusSub: page.get('statusSub').text(),
    sheet,
    ...(sheet === 'roundResultOverlay' ? { laidOff: laidOffOnPage(page) } : {}),
    ...layoffOnPage(page, groups),
    ...(sheet === 'discardsOverlay'
      ? {
          dc: {
            seen: chipsOnPage(page, 'seen'),
            held: chipsOnPage(page, 'held'),
            top: chipsOnPage(page, 'top')[0] ?? null,
            withHand: page.get('discardsHandToggle').checked(),
          },
        }
      : {}),
  };
};

const must = (id: string): Story => {
  const story = storyById(id);
  if (story === null) throw new Error(`no story ${id}`);
  return story;
};

const IDS = [
  'upcard-mine',
  'upcard-theirs',
  'draw-theirs',
  'draw-mine-open',
  'draw-mine-forced',
  'drawn-stock-shown',
  'drawn-discard-shown',
  'taken-upcard-shown',
  'drawn-pending-guest',
  'accepted-fresh',
  'arranged-after-accept',
  'accepted-selected',
  'accepted-knock',
  'accepted-gin',
  'accepted-two-ways',
  'meld-chooser-open',
  'human-meld',
  'sorted-by-rank',
  'manual-order',
  'arrange-sheet-open',
  'hand-three-rows',
  'undo-back-to-draw',
  'after-discard-theirs',
  'discarded-kept-picture',
  'discards-open',
  'discards-with-hand',
  'layoff-mine',
  'layoff-theirs',
  'round-over-table',
  'round-over-laid-off',
  'round-over-laid-off-defender',
];

describe('the catalogue', () => {
  test('the stories of docs/design/gin-draw-ghost-slot.md §7 and gin-arrangement-and-discards.md §10, unique and kebab-case', () => {
    expect(STORIES.map((s) => s.id)).toEqual(IDS);
    expect(new Set(STORIES.map((s) => s.id)).size).toBe(STORIES.length);
    STORIES.forEach((s) => {
      expect(s.id).toMatch(KEBAB);
      expect(s.title).not.toBe('');
    });
  });

  test('storyById finds each story and nothing else', () => {
    STORIES.forEach((s) => {
      expect(storyById(s.id)).toBe(s);
    });
    expect(storyById('')).toBeNull();
    expect(storyById('no-such-story')).toBeNull();
  });

  test('every sameHandAs names another story; only the undo story skips its screenshot', () => {
    STORIES.forEach((s) => {
      if (s.sameHandAs === undefined) return;
      expect(s.sameHandAs).not.toBe(s.id);
      expect(storyById(s.sameHandAs)).not.toBeNull();
    });
    expect(STORIES.filter((s) => !s.screenshot).map((s) => s.id)).toEqual(['undo-back-to-draw']);
    expect(STORIES.filter((s) => s.sameHandAs !== undefined).map((s) => s.id)).toEqual([
      'drawn-stock-shown',
      'drawn-discard-shown',
      'taken-upcard-shown',
      'accepted-fresh',
      'undo-back-to-draw',
    ]);
  });

  test('the deals are seeded: the knock and two-ways searches start at SEED and find a seed', () => {
    expect(SEED).toBe(12);
    expect(KNOCK_SEED).toBeGreaterThanOrEqual(SEED);
    expect(TWO_WAYS_SEED).toBeGreaterThanOrEqual(SEED);
    // The knock follows a stock draw, which is final: no undo button.
    expect(must('accepted-knock').facts.actions).toEqual([
      { act: 'discard', enabled: true },
      { act: 'knock', enabled: true },
    ]);
    expect(must('accepted-two-ways').app.view?.meldOptions.length).toBeGreaterThanOrEqual(2);
  });

  test('only a draw from the discard pile offers the undo button (docs/design/gin-arrangement-and-discards.md §4)', () => {
    const undoable = STORIES.filter((s) => s.facts.actions.some((a) => a.act === 'undoDraw'));
    expect(undoable.map((s) => s.id)).toEqual(['drawn-discard-shown', 'taken-upcard-shown']);
    expect(must('undo-back-to-draw').app.game?.discard.length).toBe(
      must('draw-mine-open').app.game?.discard.length,
    );
  });

  test('the sheet fact: the chooser, the arrange sheet and the result sheet each on their stories only', () => {
    const sheets: Readonly<Record<string, SheetState>> = {
      'meld-chooser-open': 'meldOverlay',
      'arrange-sheet-open': 'arrangeOverlay',
      'discards-open': 'discardsOverlay',
      'discards-with-hand': 'discardsOverlay',
      'round-over-laid-off': 'roundResultOverlay',
      'round-over-laid-off-defender': 'roundResultOverlay',
    };
    STORIES.forEach((s) => {
      expect(s.facts.sheet, s.id).toBe(sheets[s.id] ?? 'none');
      expect('laidOff' in s.facts, s.id).toBe(s.facts.sheet === 'roundResultOverlay');
      expect('dc' in s.facts, s.id).toBe(s.facts.sheet === 'discardsOverlay');
    });
  });

  test('the discards stories: every discard of the hand greyed, the top ringed, my hand only when included', () => {
    const open = must('discards-open');
    const game = open.app.game;
    if (game === null) throw new Error('no game');
    expect(open.facts.dc?.seen).toHaveLength(game.discard.length);
    expect(open.facts.dc?.seen.length).toBeGreaterThan(1);
    expect(open.facts.dc?.top).toBe(game.discard.at(-1)?.id);
    expect(open.facts.dc?.held).toEqual([]);
    expect(open.facts.dc?.withHand).toBe(false);
    const withHand = must('discards-with-hand');
    expect(withHand.facts.dc?.held).toHaveLength(11);
    expect(withHand.facts.dc?.withHand).toBe(true);
    const page = painted(withHand).page;
    expect(page.get('discardsOverlay').hidden()).toBe(false);
    expect(
      (
        page
          .get('discardsGrid')
          .text()
          .match(/<span class="dc[ "]/g) ?? []
      ).length,
    ).toBe(52);
    expect(page.get('discardsSub').text()).toBe(
      `${String(game.discard.length)} of 52 discarded · 11 in your hand`,
    );
  });

  test('the arrange fact: off out of play and while a draw shows, due where the picture differs from what was asked', () => {
    const due = STORIES.filter((s) => s.facts.arrange === 'due').map((s) => s.id);
    expect(due).toEqual(
      expect.arrayContaining(['accepted-fresh', 'accepted-selected', 'discarded-kept-picture']),
    );
    expect(due).not.toContain('arranged-after-accept');
    expect(due).not.toContain('human-meld');
    STORIES.forEach((s) => {
      const shown = s.app.draw !== null;
      const over = s.app.view?.phase === 'roundOver';
      if (shown || over) expect(s.facts.arrange, s.id).toBe('off');
    });
    expect(STORIES.filter((s) => s.facts.human.length > 0).map((s) => s.id)).toEqual([
      'human-meld',
    ]);
    expect(STORIES.map((s) => [s.id, s.facts.sort]).filter(([, sort]) => sort !== 'suit')).toEqual([
      ['sorted-by-rank', 'rank'],
      ['manual-order', 'manual'],
    ]);
    // Manual keeps the loose cards as they are: the reversed order is what was asked for.
    const manual = STORIES.find((s) => s.id === 'manual-order');
    expect(manual?.facts.arrange).toBe('idle');
    const rank = STORIES.find((s) => s.id === 'sorted-by-rank');
    expect(manual?.app.picture?.loose.map((c) => c.id)).not.toEqual(
      rank?.app.picture?.loose.map((c) => c.id),
    );
  });

  test('every story is a table screen with a view; the guest story has no game', () => {
    STORIES.forEach((s) => {
      expect(s.app.screen, s.id).toBe('tableScreen');
      expect(s.app.view, s.id).not.toBeNull();
      expect(s.app.picture, s.id).not.toBeNull();
      expect(s.app.role, s.id).toBe(s.id === 'drawn-pending-guest' ? 'guest' : 'local');
      expect(s.app.game === null, s.id).toBe(s.id === 'drawn-pending-guest');
    });
  });
});

describe('every story painted on the page fake', () => {
  STORIES.forEach((story) => {
    test(`${story.id}: paints without throwing and shows its facts`, () => {
      const p = painted(story);
      expect(p.page.get('tableScreen').hidden()).toBe(false);
      expect(factsOnPage(p)).toEqual(story.facts);
      // Eleven cells, less one per card the defender (whose turn the layoff phase is) laid off (§7b).
      const laid =
        story.facts.layoff !== undefined && story.app.view?.isMyTurn === true
          ? story.facts.layoff.laid.length
          : 0;
      expect(story.facts.slots).toBe(11 - laid);
    });
  });

  test('the shown stories paint the drawn card fresh in the ghost cell and the kept ten before it', () => {
    ['drawn-stock-shown', 'drawn-discard-shown', 'taken-upcard-shown'].forEach((id) => {
      const html = hand(must(id));
      expect(html).toContain('<div class="slot ghost shown"><div class="card ');
      expect(slotCards(html).slice(0, 10)).toEqual(heldCards(must(id)));
      expect(slotCards(html)[10]).toBe(must(id).facts.freshId);
    });
  });

  test('sameHandAs pairs hold the same card in each of the first ten slots, by the picture and by the paint', () => {
    STORIES.filter((s) => s.sameHandAs !== undefined).forEach((story) => {
      const other = must(story.sameHandAs ?? '');
      expect(heldCards(story), story.id).toEqual(heldCards(other));
      expect(heldCards(story)).toHaveLength(10);
      const mine = slotCards(hand(story)).slice(0, 10);
      const theirs = slotCards(hand(other)).slice(0, 10);
      expect(mine, story.id).toEqual(theirs);
      expect(mine).toEqual(heldCards(story));
    });
  });

  test('undo-back-to-draw paints the same hand markup as draw-mine-open', () => {
    const undo = painted(must('undo-back-to-draw')).page;
    const open = painted(must('draw-mine-open')).page;
    expect(undo.get('hand').text()).toBe(open.get('hand').text());
    expect(undo.get('actions').text()).toBe(open.get('actions').text());
  });

  test('accepted-fresh keeps the ten and appends the drawn card loose; arranged-after-accept re-melds the eleven', () => {
    const fresh = must('accepted-fresh');
    const freshSlots = slots(hand(fresh));
    expect(freshSlots).toHaveLength(11);
    expect(freshSlots[10]?.[0]).toEqual(['dead']);
    expect(freshSlots[10]?.[1]).toBe(fresh.facts.freshId);
    expect(fresh.facts.arrange).toBe('due');
    const arranged = must('arranged-after-accept');
    expect(arranged.facts.arrange).toBe('idle');
    expect(arranged.facts.freshId).toBe(fresh.facts.freshId);
    expect(hand(arranged)).not.toBe(hand(fresh));
    expect(new Set(slotCards(hand(arranged)))).toEqual(new Set(slotCards(hand(fresh))));
  });

  test('the accepted stories paint eleven card slots and no ghost cell; the gin story says GIN!', () => {
    [
      'accepted-fresh',
      'arranged-after-accept',
      'accepted-selected',
      'accepted-knock',
      'accepted-gin',
      'accepted-two-ways',
      'human-meld',
      'sorted-by-rank',
      'manual-order',
      'hand-three-rows',
    ].forEach((id) => {
      const html = hand(must(id));
      expect(html, id).not.toContain('ghost');
      expect(
        slotCards(html).filter((c) => c !== null),
        id,
      ).toHaveLength(11);
    });
    const gin = painted(must('accepted-gin')).page;
    expect(gin.get('actions').text()).toContain('>GIN! <small>(0)</small></button>');
    expect(gin.get('deadwoodInfo').text()).toBe('Deadwood after discard: 0');
    expect(painted(must('accepted-knock')).page.get('actions').text()).toMatch(
      />Knock <small>\(\d+\)<\/small><\/button>/,
    );
  });

  test('human-meld: the hand-made meld is the first group, its cells marked human, Arrange idle', () => {
    const story = must('human-meld');
    const html = hand(story);
    const first = slots(html).filter(([classes]) => classes.includes('human'));
    expect(first.map(([, id]) => id)).toEqual(story.facts.human);
    expect(story.facts.human.length).toBeGreaterThanOrEqual(3);
    expect(html.startsWith('<div class="group n')).toBe(true);
    expect(slotCards(html).slice(0, story.facts.human.length)).toEqual(story.facts.human);
    expect(story.facts.arrange).toBe('idle');
  });

  test('the sort stories: the loose cards ascend by rank; by suit under the default; manual keeps them reversed', () => {
    const view = must('sorted-by-rank').app.view;
    if (view === null) throw new Error('no view');
    const byId = new Map(view.me.hand.map((c) => [c.id, c]));
    const looseOf = (id: string): ReadonlyArray<string> =>
      slots(hand(must(id)))
        .filter(([classes]) => classes.includes('dead'))
        .flatMap(([, card]) => (card === null ? [] : [card]));
    const ranks = looseOf('sorted-by-rank').map((id) => byId.get(id)?.r ?? 0);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    // The default (`arranged-after-accept`): by suit, spades first.
    const suits = looseOf('arranged-after-accept').map((id) =>
      'SHDC'.indexOf(byId.get(id)?.s ?? ''),
    );
    expect([...suits].sort((a, b) => a - b)).toEqual(suits);
    // Manual: the same loose cards, in the order the player left them (reversed here).
    expect(looseOf('manual-order')).toEqual([...looseOf('arranged-after-accept')].reverse());
    const active = (id: string): string | null =>
      painted(must(id))
        .modes.find((b) => b.hasClass('active'))
        ?.attr('data-sort') ?? null;
    expect(active('manual-order')).toBe('manual');
    expect(active('sorted-by-rank')).toBe('rank');
    expect(active('arranged-after-accept')).toBe('suit');
  });

  test('hand-three-rows: the run of seven is one group, three rows on a phone', () => {
    const story = must('hand-three-rows');
    expect(hand(story)).toContain('<div class="group n7">');
    expect(story.facts.rows).toBe(3);
    STORIES.filter((s) => s.id !== 'hand-three-rows').forEach((s) => {
      expect(s.facts.rows, s.id).toBe(2);
    });
  });

  test('discarded-kept-picture: the broken group stays in place as dead cells, Arrange due', () => {
    const story = must('discarded-kept-picture');
    const html = hand(story);
    expect(html).toMatch(/<div class="group n[12]"><div class="slot dead">/);
    expect(slotCards(html).filter((c) => c !== null)).toHaveLength(10);
    expect(story.facts.arrange).toBe('due');
    // The dot went with the discard: it is the opponent's turn (SlotHandView.ts).
    expect(story.facts.freshId).toBeNull();
    expect(must('after-discard-theirs').facts.freshId).toBeNull();
    expect(must('round-over-table').facts.freshId).toBeNull();
    expect(must('accepted-two-ways').facts.freshId).not.toBeNull();
  });

  test('the chooser and the arrange sheet paint over their hands', () => {
    const chooser = painted(must('meld-chooser-open')).page;
    expect(chooser.get('meldOverlay').hidden()).toBe(false);
    expect(chooser.get('meldOptionList').text()).toContain('(in use)');
    expect(chooser.get('deadwoodInfo').text()).toMatch(/⇄ \d+ ways/);
    const sheet = painted(must('arrange-sheet-open'));
    expect(sheet.page.get('arrangeOverlay').hidden()).toBe(false);
    expect(sheet.modes.filter((b) => b.hasClass('active')).map((b) => b.attr('data-sort'))).toEqual(
      ['suit'],
    );
  });

  test('the laid-off stories open the sheet naming 4S 5S laid off onto the spades, from both seats', () => {
    ['round-over-laid-off', 'round-over-laid-off-defender'].forEach((id) => {
      const story = must(id);
      expect(story.facts.laidOff).toEqual(['4S', '5S']);
      const page = painted(story).page;
      expect(page.get('roundResultOverlay').hidden()).toBe(false);
      expect(page.get('rrTitle').text()).toBe('Ann knocked');
      expect(page.get('rrBody').text()).toContain(
        '<div class="rr-label">Laid off onto Ann\'s melds</div><div class="meld-group laid">',
      );
      expect(page.get('rrBody').text()).toContain('<div class="rr-label">Deadwood · 20</div>');
      expect(laidOffOnPage(page)).toEqual(['4S', '5S']);
      expect(page.get('actions').text()).toContain('data-act="showResult"');
    });
    expect(must('round-over-laid-off').app.view?.me.name).toBe('Ann');
    expect(must('round-over-laid-off-defender').app.view?.me.name).toBe('Bob');
  });

  test('round-over-table keeps the result sheet put away and offers Show results', () => {
    const page = painted(must('round-over-table')).page;
    expect(page.get('roundResultOverlay').hidden()).toBe(true);
    expect(page.get('actions').text()).toContain('data-act="showResult"');
    expect(page.get('statusBanner').hasClass('mine')).toBe(false);
  });

  test('the guest story shows the pending cell, the connection dot and the Drawing… line', () => {
    const page = painted(must('drawn-pending-guest')).page;
    expect(page.get('hand').text()).toContain('<div class="slot ghost pending"></div>');
    expect(page.get('connDot').attr('class')).toBe('conn-dot on');
    expect(page.get('statusMain').text()).toBe('Your turn');
  });
});
