// The ladder (docs/MIGRATION.md step 9): typed from legacy/fidice/index.html lines 3080-3169
// (bundle section "// src/view/screens/ladder.ts"); every id, class, tooltip and text is the
// bundle's. A nested list: the eight categories, each opening to its hand groups, each opening to
// its kicker variants; `Marks` highlight the current bid and (for spectators) the cup's true rank
// and dim the rows at or below the bid. The row ids (`main-r17`, `main-gpair|3`, `main-cat-pair`)
// are what the controller scrolls to.
import { CATEGORY_INFO, inRange, rungOf } from '../../domain/hands.ts';
import type { Category, CategoryInfo, Group, Hand, Rank } from '../../domain/types.ts';
import { diceRow, shapeRow } from '../components.ts';
import type { Dispatch, Ladder, LadderId, Marks, Ui } from '../types.ts';
import { cls, h, type VNode } from '../vdom.ts';

const noMarks: Marks = { bid: null, cup: null, dimAtOrBelow: null };

const catKey = (cat: Category): string => `cat:${cat}`;
const rowId = (ladder: LadderId, rank: Rank): string => `${ladder}-r${String(rank)}`;
const groupId = (ladder: LadderId, key: string): string => `${ladder}-g${key.replace(/\|/g, '_')}`;
const catId = (ladder: LadderId, cat: Category): string => `${ladder}-cat-${cat}`;

/** A row is open when the player opened it, or everything is, or a mark falls inside its range. */
const isOpen = (l: Ladder, key: string, lo: Rank, hi: Rank, marks: Marks): boolean => {
  if (l.closed.has(key)) return false;
  if (l.allOpen || l.open.has(key)) return true;
  return inRange(marks.bid, lo, hi) || inRange(marks.cup, lo, hi);
};

const markers = (lo: Rank, hi: Rank, marks: Marks): ReadonlyArray<VNode> => [
  ...(inRange(marks.bid, lo, hi) ? [h('span', { class: 'tab-marker bid' }, '\u{1F4E3} BID')] : []),
  ...(inRange(marks.cup, lo, hi) ? [h('span', { class: 'tab-marker cup' }, '\u{1F964} CUP')] : []),
];

const markClasses = (lo: Rank, hi: Rank, marks: Marks): string =>
  cls(inRange(marks.bid, lo, hi) && 'mark-bid', inRange(marks.cup, lo, hi) && 'mark-cup');

const dim = (rank: Rank, marks: Marks): string =>
  cls(marks.dimAtOrBelow !== null && rank <= marks.dimAtOrBelow && 'dim');

const rungCell = (lo: Rank, hi: Rank): VNode =>
  h(
    'div',
    { class: 'rank' },
    h('b', {}, lo === hi ? String(rungOf(lo)) : `${String(rungOf(lo))}–${String(rungOf(hi))}`),
    lo === hi ? 'rung' : 'rungs',
  );

const handRow = (ladder: LadderId, hnd: Hand, variant: boolean, marks: Marks): VNode =>
  h(
    'div',
    {
      class: cls(
        'lrow',
        variant ? 'variant' : 'hand',
        markClasses(hnd.rank, hnd.rank, marks),
        dim(hnd.rank, marks),
      ),
      id: rowId(ladder, hnd.rank),
      key: `r${String(hnd.rank)}`,
    },
    rungCell(hnd.rank, hnd.rank),
    h('div', {}, h('div', { class: 'nm' }, hnd.name)),
    diceRow(hnd.dice, 'sm'),
    markers(hnd.rank, hnd.rank, marks),
  );

const groupRows = (
  ladder: LadderId,
  l: Ladder,
  g: Group,
  marks: Marks,
  dispatch: Dispatch,
): ReadonlyArray<VNode> => {
  if (!g.collapsible) return [handRow(ladder, g.hands[0], false, marks)];
  const open = isOpen(l, g.key, g.minRank, g.maxRank, marks);
  const top = g.hands[0];
  const coreCount = g.cat === 'fullhouse' ? 3 : top.dice.length - top.kickers.length;
  const row = h(
    'div',
    {
      class: cls(
        'lrow group tip-below',
        open && 'open',
        !open && markClasses(g.minRank, g.maxRank, marks),
        dim(g.maxRank, marks),
      ),
      id: groupId(ladder, g.key),
      key: `g${g.key}`,
      tip: open ? 'Collapse' : 'Show variants',
      on: {
        click: () => {
          dispatch({ type: 'ladder.toggle', ladder, key: g.key });
        },
      },
    },
    rungCell(g.minRank, g.maxRank),
    h(
      'div',
      {},
      h('div', { class: 'nm' }, g.name),
      h('div', { class: 'sub' }, `${String(g.hands.length)} variants`),
    ),
    diceRow(top.dice.slice(0, coreCount), 'sm'),
    !open && markers(g.minRank, g.maxRank, marks),
  );
  return [row, ...(open ? g.hands.map((hnd) => handRow(ladder, hnd, true, marks)) : [])];
};

const categoryRows = (
  ladder: LadderId,
  l: Ladder,
  c: CategoryInfo,
  marks: Marks,
  dispatch: Dispatch,
): ReadonlyArray<VNode> => {
  const key = catKey(c.cat);
  const open = isOpen(l, key, c.minRank, c.maxRank, marks);
  const row = h(
    'div',
    {
      class: cls(
        'lrow catrow tip-below',
        open && 'open',
        !open && markClasses(c.minRank, c.maxRank, marks),
      ),
      id: catId(ladder, c.cat),
      key,
      tip: open ? 'Collapse' : 'Expand',
      on: {
        click: () => {
          dispatch({ type: 'ladder.toggle', ladder, key });
        },
      },
    },
    rungCell(c.minRank, c.maxRank),
    h(
      'div',
      {},
      h('div', { class: 'nm' }, c.label),
      h(
        'div',
        { class: 'sub' },
        `${c.blurb} \xB7 ${String(c.hands.length)} hand${c.hands.length > 1 ? 's' : ''}`,
      ),
    ),
    shapeRow(c.cat),
    !open && markers(c.minRank, c.maxRank, marks),
  );
  return [row, ...(open ? c.groups.flatMap((g) => groupRows(ladder, l, g, marks, dispatch)) : [])];
};

const ladderView = (
  ladder: LadderId,
  l: Ladder,
  marks: Marks,
  dispatch: Dispatch,
  extraClass?: string,
  style?: string,
): VNode =>
  h(
    'div',
    { class: cls('ladder', extraClass), id: `${ladder}Ladder`, ...(style ? { style } : {}) },
    CATEGORY_INFO.flatMap((c) => categoryRows(ladder, l, c, marks, dispatch)),
  );

/** The main ladder marks the current bid only. */
const mainMarks = (ui: Ui): Marks => ({
  bid: ui.game?.round?.bid ?? null,
  cup: null,
  dimAtOrBelow: null,
});

const ladderTab = (ui: Ui, dispatch: Dispatch): VNode =>
  h(
    'section',
    { id: 'tab-ladder' },
    h(
      'div',
      { class: 'ladder-head' },
      h('h2', { style: 'font-size:26px;color:var(--pine)' }, 'The Ladder'),
      h(
        'span',
        { class: 'muted small' },
        "252 hands \xB7 strongest at the top. Collapsed, it's just the 8 poker hands — click a category to open it, then a hand to see its kicker variants.",
      ),
      h('span', { class: 'spacer' }),
      h(
        'button',
        {
          class: 'btn-secondary',
          id: 'btnExpandAll',
          tip: 'Open or close every group',
          on: {
            click: () => {
              dispatch({ type: 'ladder.expandAll', ladder: 'main' });
            },
          },
        },
        ui.ladders.main.allOpen ? 'Collapse all' : 'Expand all',
      ),
    ),
    h(
      'div',
      { class: 'ladder-head', style: 'margin-top:-4px' },
      h('span', { class: 'small muted', style: 'font-weight:800' }, 'Jump to:'),
      h(
        'div',
        { class: 'legend' },
        CATEGORY_INFO.map((c) =>
          h(
            'span',
            {
              class: 'chip',
              on: {
                click: () => {
                  dispatch({ type: 'ladder.jump', cat: c.cat });
                },
              },
            },
            c.label,
          ),
        ),
      ),
    ),
    ladderView('main', ui.ladders.main, mainMarks(ui), dispatch),
  );

export { noMarks, catKey, rowId, groupId, catId, isOpen, ladderView, mainMarks, ladderTab };
