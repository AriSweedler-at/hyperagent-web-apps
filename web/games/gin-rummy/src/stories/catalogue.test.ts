// The catalogue against the paint (docs/design/gin-draw-ghost-slot.md §8): every story paints on
// the page fake built from the page's own markup, and the facts the catalogue derived from the
// engine are read back out of the painted strings (the slot and card counts, the ghost cell's
// class, the fresh, locked and selected cards, the piles' classes, the buttons and their state,
// the status line). The `sameHandAs` pairs must hold the same card in each of the first ten slots,
// as the engine orders them and as the paint wrote them. No jsdom (docs/ARCHITECTURE.md "Testing
// pyramid"); e2e/gin-stories.spec.ts repeats the facts against the served DOM.
import { describe, expect, test } from 'vitest';

import { slotHandView } from '../ui/hand/SlotHandView.ts';
import { ginPage, type GinPage } from '../ui/page.fake.ts';
import { paint } from '../ui/render.ts';
import {
  KNOCK_SEED,
  SEED,
  STORIES,
  heldCards,
  storyById,
  type GhostState,
  type SheetState,
  type Story,
  type StoryFacts,
} from './catalogue.ts';

import MARKUP from '../../index.html?raw';

const painted = (story: Story): GinPage => {
  const page = ginPage(MARKUP);
  paint(page.doc, story.app, slotHandView);
  return page;
};

const KEBAB = /^[a-z]+(?:-[a-z]+)*$/;
const CARD = /<div class="card ([^"]*)" data-card="([^"]+)">/g;
const SLOT = /<div class="slot ([^"]*)">(?:<div class="card [^"]*" data-card="([^"]+)">)?/g;
const BUTTON = /<button [^>]*data-act="([^"]+)"([^>]*)>/g;

/** `(classes, id)` of every card in `#hand`, in order. */
const cards = (hand: string): ReadonlyArray<readonly [ReadonlyArray<string>, string]> =>
  [...hand.matchAll(CARD)].map((m) => [(m[1] ?? '').split(' '), m[2] ?? ''] as const);

/** The one card carrying `flag`, or null; two would be a paint bug. */
const flagged = (hand: string, flag: string): string | null => {
  const ids = cards(hand)
    .filter(([classes]) => classes.includes(flag))
    .map(([, id]) => id);
  expect(ids.length, `${flag} cards`).toBeLessThanOrEqual(1);
  return ids[0] ?? null;
};

/** The card id in each slot, in order (null for the ghost cell without a card). */
const slotCards = (hand: string): ReadonlyArray<string | null> =>
  [...hand.matchAll(SLOT)].map((m) => m[2] ?? null);

/** The ghost cell's class as painted: `none` without a cell, `hidden` for the bare cell. */
const ghostOnPage = (hand: string): GhostState => {
  const cell = /<div class="slot ghost( open| pending| shown)?">/.exec(hand);
  if (cell === null) return 'none';
  const kind = (cell[1] ?? '').trim();
  return kind === 'open' || kind === 'pending' || kind === 'shown' ? kind : 'hidden';
};

/** The one overlay not hidden, by id, or `none`. */
const sheetOnPage = (page: GinPage): SheetState =>
  !page.get('meldOverlay').hidden()
    ? 'meldOverlay'
    : !page.get('roundResultOverlay').hidden()
      ? 'roundResultOverlay'
      : 'none';

/** The ids of the mini cards under the result sheet's "Laid off onto" label (the deadwood label follows). */
const laidOffOnPage = (page: GinPage): ReadonlyArray<string> => {
  const laid = /<div class="meld-group laid">(.*?)<\/div><div class="rr-label">/.exec(
    page.get('rrBody').text(),
  );
  return [...(laid?.[1] ?? '').matchAll(CARD)].map((m) => m[2] ?? '');
};

/** The facts as the painted page shows them, in the catalogue's terms. */
const factsOnPage = (page: GinPage): StoryFacts => {
  const hand = page.get('hand').text();
  const stock = page.get('stockPile');
  const disc = page.get('discardPile');
  const sheet = sheetOnPage(page);
  return {
    slots: (hand.match(/<div class="slot /g) ?? []).length,
    handCards: cards(hand).length,
    ghost: ghostOnPage(hand),
    freshId: flagged(hand, 'fresh'),
    lockedId: flagged(hand, 'locked'),
    selectedId: flagged(hand, 'selected'),
    stock: stock.hasClass('tappable') ? 'tappable' : 'idle',
    discard: disc.hasClass('tappable') ? 'tappable' : disc.hasClass('blocked') ? 'blocked' : 'idle',
    actions: [...page.get('actions').text().matchAll(BUTTON)].map((m) => ({
      act: m[1] ?? '',
      enabled: !/\bdisabled\b/.test(m[2] ?? ''),
    })),
    statusSub: page.get('statusSub').text(),
    sheet,
    ...(sheet === 'roundResultOverlay' ? { laidOff: laidOffOnPage(page) } : {}),
  };
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
  'accepted-selected',
  'accepted-knock',
  'accepted-gin',
  'undo-back-to-draw',
  'after-discard-theirs',
  'round-over-table',
  'round-over-laid-off',
  'round-over-laid-off-defender',
];

describe('the catalogue', () => {
  test('eighteen stories with the ids of docs/design/gin-draw-ghost-slot.md §7 and gin-arrangement-and-discards.md §10, unique and kebab-case', () => {
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
      'undo-back-to-draw',
    ]);
  });

  test('the deal is seeded: the knock search starts at SEED and finds a seed that offers one', () => {
    expect(SEED).toBe(12);
    expect(KNOCK_SEED).toBeGreaterThanOrEqual(SEED);
    // The knock follows a stock draw, which is final: no undo button.
    const knock = storyById('accepted-knock');
    expect(knock?.facts.actions).toEqual([
      { act: 'discard', enabled: true },
      { act: 'knock', enabled: true },
    ]);
  });

  test('only a draw from the discard pile offers the undo button (docs/design/gin-arrangement-and-discards.md §4)', () => {
    const undoable = STORIES.filter((s) => s.facts.actions.some((a) => a.act === 'undoDraw'));
    expect(undoable.map((s) => s.id)).toEqual(['drawn-discard-shown', 'taken-upcard-shown']);
    expect(storyById('undo-back-to-draw')?.app.game?.discard.length).toBe(
      storyById('draw-mine-open')?.app.game?.discard.length,
    );
  });

  test('the sheet fact: the result sheet open on the laid-off stories only', () => {
    STORIES.forEach((s) => {
      expect(s.facts.sheet, s.id).toBe(
        s.id.startsWith('round-over-laid-off') ? 'roundResultOverlay' : 'none',
      );
      expect('laidOff' in s.facts, s.id).toBe(s.facts.sheet === 'roundResultOverlay');
    });
  });

  test('every story is a table screen with a view; the guest story has no game', () => {
    STORIES.forEach((s) => {
      expect(s.app.screen, s.id).toBe('tableScreen');
      expect(s.app.view, s.id).not.toBeNull();
      expect(s.app.role, s.id).toBe(s.id === 'drawn-pending-guest' ? 'guest' : 'local');
      expect(s.app.game === null, s.id).toBe(s.id === 'drawn-pending-guest');
    });
  });
});

describe('every story painted on the page fake', () => {
  STORIES.forEach((story) => {
    test(`${story.id}: paints without throwing and shows its facts`, () => {
      const page = painted(story);
      expect(page.get('tableScreen').hidden()).toBe(false);
      expect(factsOnPage(page)).toEqual(story.facts);
      expect(story.facts.slots).toBe(11);
    });
  });

  test('the shown stories paint the drawn card fresh in the ghost cell and the held ten from the hold', () => {
    ['drawn-stock-shown', 'drawn-discard-shown', 'taken-upcard-shown'].forEach((id) => {
      const story = storyById(id);
      if (story === null) throw new Error(id);
      const hand = painted(story).get('hand').text();
      expect(hand).toContain('<div class="slot ghost shown"><div class="card ');
      expect(slotCards(hand).slice(0, 10)).toEqual(heldCards(story));
      expect(slotCards(hand)[10]).toBe(story.facts.freshId);
    });
  });

  test('sameHandAs pairs hold the same card in each of the first ten slots, by the engine and by the paint', () => {
    STORIES.filter((s) => s.sameHandAs !== undefined).forEach((story) => {
      const other = storyById(story.sameHandAs ?? '');
      if (other === null) throw new Error(story.id);
      expect(heldCards(story), story.id).toEqual(heldCards(other));
      expect(heldCards(story)).toHaveLength(10);
      const mine = slotCards(painted(story).get('hand').text()).slice(0, 10);
      const theirs = slotCards(painted(other).get('hand').text()).slice(0, 10);
      expect(mine, story.id).toEqual(theirs);
      expect(mine).toEqual(heldCards(story));
    });
  });

  test('undo-back-to-draw paints the same hand markup as draw-mine-open', () => {
    const undo = storyById('undo-back-to-draw');
    const open = storyById('draw-mine-open');
    if (undo === null || open === null) throw new Error('missing story');
    expect(painted(undo).get('hand').text()).toBe(painted(open).get('hand').text());
    expect(painted(undo).get('actions').text()).toBe(painted(open).get('actions').text());
  });

  test('the accepted stories paint eleven card slots and no ghost cell; the gin story says GIN!', () => {
    ['accepted-fresh', 'accepted-selected', 'accepted-knock', 'accepted-gin'].forEach((id) => {
      const story = storyById(id);
      if (story === null) throw new Error(id);
      const hand = painted(story).get('hand').text();
      expect(hand).not.toContain('ghost');
      expect(slotCards(hand).filter((c) => c !== null)).toHaveLength(11);
    });
    const gin = storyById('accepted-gin');
    if (gin === null) throw new Error('accepted-gin');
    const page = painted(gin);
    expect(page.get('actions').text()).toContain('>GIN! <small>(0)</small></button>');
    expect(page.get('deadwoodInfo').text()).toBe('Deadwood after discard: 0');
    const knock = storyById('accepted-knock');
    if (knock === null) throw new Error('accepted-knock');
    expect(painted(knock).get('actions').text()).toMatch(
      />Knock <small>\(\d+\)<\/small><\/button>/,
    );
  });

  test('the laid-off stories open the sheet naming 4S 5S laid off onto the spades, from both seats', () => {
    ['round-over-laid-off', 'round-over-laid-off-defender'].forEach((id) => {
      const story = storyById(id);
      if (story === null) throw new Error(id);
      expect(story.facts.laidOff).toEqual(['4S', '5S']);
      const page = painted(story);
      expect(page.get('roundResultOverlay').hidden()).toBe(false);
      expect(page.get('rrTitle').text()).toBe('Ann knocked');
      expect(page.get('rrBody').text()).toContain(
        '<div class="rr-label">Laid off onto Ann\'s melds</div><div class="meld-group laid">',
      );
      expect(page.get('rrBody').text()).toContain('<div class="rr-label">Deadwood · 20</div>');
      expect(laidOffOnPage(page)).toEqual(['4S', '5S']);
      expect(page.get('actions').text()).toContain('data-act="showResult"');
    });
    expect(storyById('round-over-laid-off')?.app.view?.me.name).toBe('Ann');
    expect(storyById('round-over-laid-off-defender')?.app.view?.me.name).toBe('Bob');
  });

  test('round-over-table keeps the result sheet put away and offers Show results', () => {
    const story = storyById('round-over-table');
    if (story === null) throw new Error('round-over-table');
    const page = painted(story);
    expect(page.get('roundResultOverlay').hidden()).toBe(true);
    expect(page.get('actions').text()).toContain('data-act="showResult"');
    expect(page.get('statusBanner').hasClass('mine')).toBe(false);
  });

  test('the guest story shows the pending cell, the connection dot and the Drawing… line', () => {
    const story = storyById('drawn-pending-guest');
    if (story === null) throw new Error('drawn-pending-guest');
    const page = painted(story);
    expect(page.get('hand').text()).toContain('<div class="slot ghost pending"></div>');
    expect(page.get('connDot').attr('class')).toBe('conn-dot on');
    expect(page.get('statusMain').text()).toBe('Your turn');
  });
});
