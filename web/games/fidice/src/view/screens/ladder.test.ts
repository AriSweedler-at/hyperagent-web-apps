// The ladder on the fake DOM: the eight category rows and their ids (the controller scrolls to
// them), opening groups and variants, the bid marker, the closed override, and expand all.
import { describe, expect, test } from 'vitest';

import { CATEGORY_INFO, handAt } from '../../domain/hands.ts';
import {
  all,
  byClass,
  byId,
  fire,
  hasClass,
  requireId,
} from '../../../../../shared/edge/dom.fake.ts';
import { renderApp } from '../render.fake.ts';
import { FIRST_BID, OPENED_GROUP, SCENARIOS } from '../scenarios.ts';

const rowIds = (root: ReturnType<typeof renderApp>['root']): ReadonlyArray<string> =>
  all(root, (el) => /^main-r\d+$/.test(el.getAttribute('id') ?? '')).map(
    (el) => el.getAttribute('id') ?? '',
  );

describe('ladderTab', () => {
  test('collapsed: the eight categories in ladder order, chips, expand all', () => {
    const { root, intents } = renderApp(SCENARIOS['ladder: collapsed']);
    requireId(root, 'tab-ladder');
    const ladder = requireId(root, 'mainLadder');
    expect(ladder.getAttribute('class')).toBe('ladder');
    const cats = byClass(ladder, 'catrow');
    expect(cats.map((c) => c.getAttribute('id'))).toEqual(
      CATEGORY_INFO.map((c) => `main-cat-${c.cat}`),
    );
    expect(cats.map((c) => byClass(c, 'nm')[0]?.textContent)).toEqual(
      CATEGORY_INFO.map((c) => c.label),
    );
    expect(cats.every((c) => byClass(c, 'shape').length === 1)).toBe(true);
    expect(byClass(ladder, 'group')).toEqual([]);
    expect(rowIds(root)).toEqual([]);
    expect(byClass(ladder, 'tab-marker')).toEqual([]);
    expect(requireId(root, 'btnExpandAll').textContent).toBe('Expand all');
    const chips = byClass(root, 'chip');
    expect(chips.map((c) => c.textContent)).toEqual(CATEGORY_INFO.map((c) => c.label));
    if (cats[0]) fire(cats[0], 'click');
    if (chips[1]) fire(chips[1], 'click');
    fire(requireId(root, 'btnExpandAll'), 'click');
    expect(intents()).toEqual([
      { type: 'ladder.toggle', ladder: 'main', key: `cat:${CATEGORY_INFO[0]?.cat ?? ''}` },
      { type: 'ladder.jump', cat: CATEGORY_INFO[1]?.cat },
      { type: 'ladder.expandAll', ladder: 'main' },
    ]);
  });

  test('a bid marks its category even when closed by hand; an opened group lists its variants', () => {
    const { root, intents } = renderApp(
      SCENARIOS['ladder: a bid marked, a group opened, its category closed'],
    );
    const bidCat = requireId(root, `main-cat-${handAt(FIRST_BID).cat}`);
    expect(hasClass(bidCat, 'open')).toBe(false);
    expect(hasClass(bidCat, 'mark-bid')).toBe(true);
    expect(byClass(bidCat, 'tab-marker').map((m) => m.textContent)).toEqual(['\u{1F4E3} BID']);
    const opened = handAt(OPENED_GROUP);
    const openCat = requireId(root, `main-cat-${opened.cat}`);
    expect(hasClass(openCat, 'open')).toBe(true);
    expect(openCat.getAttribute('data-tip')).toBe('Collapse');
    const group = requireId(root, `main-g${opened.groupKey.replace(/\|/g, '_')}`);
    expect(hasClass(group, 'open')).toBe(true);
    const variants = CATEGORY_INFO.find((c) => c.cat === opened.cat)?.groups.find(
      (g) => g.key === opened.groupKey,
    );
    expect(variants?.collapsible).toBe(true);
    expect(rowIds(root)).toEqual(
      expect.arrayContaining(variants?.hands.map((h) => `main-r${String(h.rank)}`) ?? []),
    );
    const row = requireId(root, `main-r${String(OPENED_GROUP)}`);
    expect(hasClass(row, 'variant')).toBe(true);
    expect(byClass(row, 'nm')[0]?.textContent).toBe(opened.name);
    expect(byId(root, 'roomPill')).not.toBeNull();
    fire(group, 'click');
    expect(intents()).toEqual([{ type: 'ladder.toggle', ladder: 'main', key: opened.groupKey }]);
  });

  test('everything open: all 252 hands are rows and the button collapses', () => {
    const { root } = renderApp(SCENARIOS['ladder: everything open']);
    expect(requireId(root, 'btnExpandAll').textContent).toBe('Collapse all');
    expect(new Set(rowIds(root)).size).toBe(252);
    expect(byClass(root, 'catrow').every((c) => hasClass(c, 'open'))).toBe(true);
    expect(byClass(root, 'group').every((g) => hasClass(g, 'open'))).toBe(true);
  });
});
