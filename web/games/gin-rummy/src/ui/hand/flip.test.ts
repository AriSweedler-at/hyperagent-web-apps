// FLIP over hand-rolled elements: a card whose rect changed across the repaint is put back with
// an inverted transform and released under the transition, then its inline transition is cleared
// when the transition ends (or the fallback timer fires); a card that stayed, a card new to the
// hand and a card with no measurable rect are left alone.
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { Element, Rect } from '../../../../../shared/edge/dom.ts';
import { FLIP_MS, flipCards } from './flip.ts';

type Card = Readonly<{
  el: Element;
  log: string[];
  place: (r: Rect) => void;
  end: () => void;
}>;

const rect = (left: number, top: number): Rect => ({ left, top, width: 50, height: 70 });
const NONE: Rect = { left: 0, top: 0, width: 0, height: 0 };

/** A card element that reports `rect`, records its inline styles and its transitionend handler. */
const card = (id: string, first: Rect): Card => {
  const state = { rect: first, onEnd: null as (() => void) | null };
  const log: string[] = [];
  const el = {
    getAttribute: () => id,
    getBoundingClientRect: () => state.rect,
    style: {
      setProperty: (name: string, value: string) => {
        log.push(`${name}=${value}`);
      },
    },
    addEventListener: (type: string, fn: () => void) => {
      if (type === 'transitionend') state.onEnd = fn;
    },
  };
  return {
    el: el as unknown as Element,
    log,
    place: (r) => {
      state.rect = r;
    },
    end: () => state.onEnd?.(),
  };
};

const hand = (cards: () => ReadonlyArray<Card>): Element =>
  ({ querySelectorAll: () => cards().map((c) => c.el) }) as unknown as Element;

afterEach(() => {
  vi.useRealTimers();
});

describe('flipCards', () => {
  test('a card that changed cells glides from its old rect; the others are untouched', () => {
    const moved = card('7H', rect(200, 0));
    const stayed = card('9D', rect(0, 0));
    const fresh = card('KC', rect(100, 80));
    const unmeasured = card('2S', NONE);
    const before = [moved, stayed, unmeasured];
    const after = [stayed, moved, fresh, unmeasured];
    const shown = { cards: before };
    flipCards(
      hand(() => shown.cards),
      () => {
        shown.cards = after;
        moved.place(rect(0, 80));
        unmeasured.place(rect(300, 300));
      },
    );
    expect(moved.log).toEqual([
      'transition=none',
      'transform=translate(200px, -80px)',
      `transition=transform ${String(FLIP_MS)}ms cubic-bezier(0.2, 0.8, 0.2, 1)`,
      'transform=',
    ]);
    moved.end();
    expect(moved.log.at(-1)).toBe('transition=');
    expect(stayed.log).toEqual([]);
    expect(fresh.log).toEqual([]);
    expect(unmeasured.log).toEqual([]);
  });

  test('a transition that never ends: the fallback timer clears the inline transition once', () => {
    vi.useFakeTimers();
    const moved = card('7H', rect(200, 0));
    const shown = { cards: [moved] };
    flipCards(
      hand(() => shown.cards),
      () => {
        moved.place(rect(0, 0));
      },
    );
    expect(moved.log).toHaveLength(4);
    vi.advanceTimersByTime(FLIP_MS + 50);
    expect(moved.log).toHaveLength(5);
    moved.end();
    expect(moved.log).toHaveLength(5);
  });

  test('a hand with no cards before the repaint (a fresh deal) only repaints', () => {
    const fresh = card('AS', rect(0, 0));
    const shown = { cards: [] as ReadonlyArray<Card> };
    flipCards(
      hand(() => shown.cards),
      () => {
        shown.cards = [fresh];
      },
    );
    expect(fresh.log).toEqual([]);
  });
});
