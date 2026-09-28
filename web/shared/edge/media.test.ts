// `watchMedia` over a fake list (the turn gate's orientation, web/shared/ui/shell.ts `gateOpen`):
// the first report is the list's `matches` for the query asked, every `change` is reported as it
// comes, a list without `addEventListener` reports once, and a host without `matchMedia` (the boot
// test's window) reports nothing. The two phone predicates are pinned letter for letter: a theme
// copies `LANDSCAPE_PHONE` into its `@media` lists (test/dist/landscape-predicate.test.ts) and the
// boot watches both, so a drift here would move the board and the gate apart.
import { describe, expect, test } from 'vitest';

import {
  LANDSCAPE_PHONE,
  PORTRAIT_PHONE,
  watchMedia,
  type MediaHostLike,
  type MediaQueryListLike,
} from './media.ts';

type Listener = (event: Readonly<{ matches: boolean }>) => void;

type World = Readonly<{
  host: MediaHostLike;
  /** Every query the host was asked. */
  queries: ReadonlyArray<string>;
  /** Every `change` listener the list was given, with its type. */
  listeners: ReadonlyArray<readonly [string, Listener]>;
  /** The list changes: every listener hears `matches`. */
  change: (matches: boolean) => void;
}>;

const world = (matches: boolean, options: Readonly<{ listenable?: false }> = {}): World => {
  const queries: string[] = [];
  const listeners: (readonly [string, Listener])[] = [];
  const list: MediaQueryListLike = {
    matches,
    ...(options.listenable === false
      ? {}
      : {
          addEventListener: (type: 'change', listener: Listener) => {
            listeners.push([type, listener]);
          },
        }),
  };
  return {
    host: {
      matchMedia: (query) => {
        queries.push(query);
        return list;
      },
    },
    queries,
    listeners,
    change: (now) => {
      listeners.forEach(([, listener]) => {
        listener({ matches: now });
      });
    },
  };
};

describe('the phone predicates', () => {
  test('a phone sideways is a coarse pointer, landscape, under 500px tall; upright the mirror with the bound on the short side', () => {
    expect(LANDSCAPE_PHONE).toBe(
      '(any-pointer: coarse) and (orientation: landscape) and (max-height: 500px)',
    );
    expect(PORTRAIT_PHONE).toBe(
      '(any-pointer: coarse) and (orientation: portrait) and (max-width: 500px)',
    );
  });
});

describe('watchMedia', () => {
  test('reports the query`s matches now, then every change as it comes', () => {
    const w = world(true);
    const seen: boolean[] = [];
    watchMedia(w.host, '(orientation: portrait)', (matches) => {
      seen.push(matches);
    });
    expect(w.queries).toEqual(['(orientation: portrait)']);
    expect(seen).toEqual([true]);
    expect(w.listeners.map(([type]) => type)).toEqual(['change']);
    w.change(false);
    w.change(true);
    expect(seen).toEqual([true, false, true]);
  });

  test('a list without addEventListener reports once; a host without matchMedia reports nothing', () => {
    const once = world(false, { listenable: false });
    const seen: boolean[] = [];
    watchMedia(once.host, '(pointer: coarse)', (matches) => {
      seen.push(matches);
    });
    expect(seen).toEqual([false]);
    expect(once.listeners).toEqual([]);
    const never: boolean[] = [];
    watchMedia({}, '(pointer: coarse)', (matches) => {
      never.push(matches);
    });
    expect(never).toEqual([]);
  });
});
