// The table on the fake DOM: the holder's seat (.seat.holder, read by e2e/fidice-online), the
// "Round N" label, the turn bar, dice zones, the numbered steps for each stage of a turn, the bid
// picker, the reveal with its countdown, game over, and the pass-the-phone cover.
import { describe, expect, test } from 'vitest';

import { asRank, handAt, spokenName } from '../../domain/hands.ts';
import {
  all,
  byClass,
  byId,
  fire,
  hasClass,
  requireId,
} from '../../../../../shared/edge/dom.fake.ts';
import { renderApp } from '../render.fake.ts';
import { FIRST_BID, SCENARIOS } from '../scenarios.ts';

const holderSeat = (root: ReturnType<typeof renderApp>['root']): string | null =>
  byClass(root, 'holder')[0]?.getAttribute('data-seat') ?? null;

const diceIn = (root: ReturnType<typeof renderApp>['root'], id: string): ReadonlyArray<string> =>
  byClass(requireId(root, id), 'die').map((d) => d.getAttribute('class') ?? '');

const stepNumbers = (root: ReturnType<typeof renderApp>['root']): ReadonlyArray<string> =>
  byClass(root, 'num').map((n) => n.textContent);

describe('gameScreen: the opener', () => {
  test('round label, holder seat, turn bar, empty table, clickable cup dice, shuffle and bid steps', () => {
    const { root, intents } = renderApp(SCENARIOS['game: opener, my turn']);
    requireId(root, 'screen-game');
    expect(all(root, (el) => el.tagName === 'B' && el.textContent === 'Round 1')).toHaveLength(1);
    expect(holderSeat(root)).toBe('0');
    expect(byClass(root, 'cupbadge')).toHaveLength(1);
    const bar = byClass(root, 'turnbar')[0];
    expect(bar?.getAttribute('class')).toBe('turnbar');
    expect(bar?.textContent).toBe(
      '\u{1F964} Your turn — you open the round. Look, shuffle, then bid.',
    );
    expect(byClass(root, 'bidcard')[0]?.textContent).toContain('None yet');
    expect(byClass(requireId(root, 'zoneTable'), 'hint')[0]?.textContent).toBe('No dice out yet.');
    const cupDice = diceIn(root, 'zoneCup');
    expect(cupDice).toHaveLength(5);
    cupDice.forEach((c) => {
      expect(c).toMatch(/^die v[1-6] clickable$/);
    });
    expect(stepNumbers(root)).toEqual(['1', '2']);
    expect(byId(root, 'stepDecide')).toBeNull();
    requireId(root, 'stepShuffle');
    requireId(root, 'stepBid');
    expect(requireId(root, 'rollCupCb').checked).toBe(false);
    expect(requireId(root, 'rollCupCb').disabled).toBe(false);
    expect(byId(root, 'rollHiddenCb')).toBeNull();
    expect(requireId(root, 'btnRoll').textContent).toBe('Roll');
    expect(requireId(root, 'btnPlaceBid').disabled).toBe(true);
    expect(byId(root, 'btnMinRaise')).toBeNull();
    expect(byId(root, 'bidList')).toBeNull();
    const firstCupDie = byClass(requireId(root, 'zoneCup'), 'die')[0];
    if (firstCupDie) fire(firstCupDie, 'click');
    fire(requireId(root, 'rollCupCb'), 'change', { checked: true });
    fire(requireId(root, 'btnRoll'), 'click');
    fire(requireId(root, 'bidSearch'), 'input', { value: '3s' });
    fire(requireId(root, 'bidSearch'), 'focus');
    fire(requireId(root, 'btnPlaceBid'), 'click');
    fire(requireId(root, 'btnFinish'), 'click');
    fire(requireId(root, 'btnLeaveGame'), 'click');
    const seeLadder = byClass(root, 'btn-ghost').find((b) => b.textContent === 'See on ladder →');
    if (seeLadder) fire(seeLadder, 'click');
    expect(intents()).toEqual([
      { type: 'play', action: { type: 'pull', die: 0 } },
      { type: 'roll.cup', on: true },
      { type: 'roll.go' },
      { type: 'picker.query', value: '3s' },
      { type: 'picker.focus' },
      { type: 'picker.place' },
      { type: 'play', action: { type: 'finish' } },
      { type: 'leave' },
      { type: 'ladder.showBid' },
    ]);
  });

  test('dice out: selectable on the table, the hidden-roll toggle and the roll label', () => {
    const { root, intents } = renderApp(
      SCENARIOS['game: opener, dice out, one selected to roll hidden'],
    );
    const tableDice = diceIn(root, 'zoneTable');
    expect(tableDice).toHaveLength(2);
    expect(tableDice[0]).toMatch(/^die v[1-6] clickable selected$/);
    expect(tableDice[1]).toMatch(/^die v[1-6] clickable$/);
    expect(diceIn(root, 'zoneCup')).toHaveLength(3);
    expect(requireId(root, 'rollHiddenCb').checked).toBe(true);
    expect(requireId(root, 'rollCupCb').checked).toBe(true);
    expect(requireId(root, 'rollCupCb').disabled).toBe(true);
    expect(requireId(root, 'btnRoll').textContent).toBe('Roll 1 table die under the cup');
    const first = byClass(requireId(root, 'zoneTable'), 'die')[0];
    if (first) fire(first, 'click');
    fire(requireId(root, 'rollHiddenCb'), 'change', { checked: false });
    expect(intents()).toEqual([
      { type: 'roll.toggleDie', die: 0 },
      { type: 'roll.hidden', on: false },
    ]);
    const ticked = renderApp(SCENARIOS['game: opener, dice out, cup ticked']).root;
    expect(requireId(ticked, 'rollCupCb').checked).toBe(true);
    expect(requireId(ticked, 'rollCupCb').disabled).toBe(false);
    expect(byId(ticked, 'rollHiddenCb')).toBeNull();
  });
});

describe('gameScreen: facing a bid', () => {
  test('untouched: the decide step only, call and peek', () => {
    const { root, intents } = renderApp(SCENARIOS['game: facing a bid, untouched']);
    expect(holderSeat(root)).toBe('1');
    expect(byClass(root, 'turnbar')[0]?.textContent).toBe(
      `\u{1F964} Your turn — Ari bid ${spokenName(FIRST_BID)}. Call it, or beat it.`,
    );
    expect(byClass(byClass(root, 'bidcard')[0] ?? root, 'val')[0]?.textContent).toBe(
      spokenName(FIRST_BID),
    );
    expect(byClass(root, 'bidcard')[0]?.textContent).toContain('by Ari \xB7 rung 41 of 252');
    expect(stepNumbers(root)).toEqual(['1']);
    requireId(root, 'stepDecide');
    expect(byId(root, 'stepShuffle')).toBeNull();
    expect(byId(root, 'stepBid')).toBeNull();
    const call = requireId(root, 'btnCall');
    expect(call.disabled).toBe(false);
    expect(call.textContent).toBe('Call liar on Ari');
    expect(diceIn(root, 'zoneCup').every((c) => c === 'die hidden-face')).toBe(true);
    expect(byClass(requireId(root, 'zoneCup'), 'small')[0]?.textContent).toBe(
      '— accept the cup to peek',
    );
    fire(call, 'click');
    fire(requireId(root, 'btnPeek'), 'click');
    expect(intents()).toEqual([
      { type: 'play', action: { type: 'call' } },
      { type: 'play', action: { type: 'peek' } },
    ]);
  });

  test('not my turn: the waiting bar, hidden cup, no actions', () => {
    const { root } = renderApp(SCENARIOS['game: facing a bid, not my turn']);
    const bar = byClass(root, 'turnbar')[0];
    expect(bar?.getAttribute('class')).toBe('turnbar wait');
    expect(bar?.textContent).toBe(`Tyler has the cup \xB7 facing ${spokenName(FIRST_BID)}…`);
    expect(byId(root, 'actions')).toBeNull();
    expect(byClass(requireId(root, 'zoneCup'), 'small')[0]?.textContent).toBe(
      '— only Tyler can see these',
    );
    expect(diceIn(root, 'zoneCup').every((c) => c === 'die hidden-face')).toBe(true);
    expect(diceIn(root, 'zoneTable').every((c) => /^die v[1-6]$/.test(c))).toBe(true);
    expect(byId(root, 'btnFinish')).not.toBeNull();
  });

  test('touched: call disabled, no peek, shuffle and bid steps, the picker list and keys', () => {
    const ui = SCENARIOS['game: touched, picker open'];
    const { root, intents } = renderApp(ui);
    expect(requireId(root, 'btnCall').disabled).toBe(true);
    expect(byId(root, 'btnPeek')).toBeNull();
    expect(stepNumbers(root)).toEqual(['1', '2', '3']);
    expect(diceIn(root, 'zoneCup').every((c) => /^die v[1-6] clickable$/.test(c))).toBe(true);
    const list = requireId(root, 'bidList');
    const options = byClass(list, 'bidopt');
    expect(options.length).toBeGreaterThan(1);
    expect(options.map((o) => hasClass(o, 'hi'))).toEqual(options.map((_, i) => i === 1));
    expect(requireId(root, 'bidSearch').value).toBe('3s');
    const minRaise = requireId(root, 'btnMinRaise');
    expect(minRaise.getAttribute('data-tip')).toBe(`One rung up: ${spokenName(asRank(41))}`);
    const search = requireId(root, 'bidSearch');
    const down = fire(search, 'keydown', { key: 'ArrowDown' });
    const up = fire(search, 'keydown', { key: 'ArrowUp' });
    const enter = fire(search, 'keydown', { key: 'Enter' });
    const escape = fire(search, 'keydown', { key: 'Escape' });
    const other = fire(search, 'keydown', { key: 'x' });
    expect([down, up, enter, escape, other].map((e) => e.defaultPrevented())).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
    const pick = options[0] && fire(options[0], 'mousedown');
    expect(pick?.defaultPrevented()).toBe(true);
    fire(minRaise, 'click');
    expect(intents()).toEqual([
      { type: 'picker.move', delta: 1 },
      { type: 'picker.move', delta: -1 },
      { type: 'picker.enter' },
      { type: 'picker.close' },
      { type: 'picker.choose', rank: expect.any(Number) as number },
      { type: 'play', action: { type: 'bid', rank: 41 } },
    ]);
  });

  test('a hand picked: the selection card and an enabled place button', () => {
    const { root, intents } = renderApp(SCENARIOS['game: touched, a hand picked']);
    expect(byId(root, 'bidList')).toBeNull();
    const sel = requireId(root, 'bidSel');
    expect(byClass(sel, 'val')[0]?.textContent).toBe(spokenName(asRank(100)));
    expect(sel.textContent).toContain(`rung 101 of 252 \xB7 ${handAt(asRank(100)).catLabel}`);
    expect(byClass(sel, 'die')).toHaveLength(5);
    const place = requireId(root, 'btnPlaceBid');
    expect(place.disabled).toBe(false);
    fire(place, 'click');
    expect(intents()).toEqual([{ type: 'picker.place' }]);
  });

  test('rolled: the shuffle step says so and hides its controls', () => {
    const { root } = renderApp(SCENARIOS['game: rolled']);
    expect(requireId(root, 'stepShuffle').textContent).toContain(
      'You already rolled this turn. You can still pull dice out.',
    );
    expect(byId(root, 'rollCupCb')).toBeNull();
    expect(byId(root, 'btnRoll')).toBeNull();
    requireId(root, 'stepBid');
  });

  test('the top bid: only a call is possible', () => {
    const { root } = renderApp(SCENARIOS['game: facing the top bid']);
    expect(requireId(root, 'btnCall').disabled).toBe(false);
    expect(byId(root, 'btnPeek')).toBeNull();
    expect(byId(root, 'stepBid')).toBeNull();
    expect(byId(root, 'stepShuffle')).toBeNull();
    expect(requireId(root, 'actions').textContent).toContain('Nothing beats Five 6s');
  });
});

describe('gameScreen: the reveal and game over', () => {
  test('the reveal: dice, hands, who lost (bad for me), the countdown and next', () => {
    const ui = SCENARIOS['game: revealed, I lost'];
    const { root, intents } = renderApp(ui);
    const reveal = requireId(root, 'reveal');
    expect(byClass(reveal, 'die')).toHaveLength(5);
    expect(byClass(reveal, 'res')[0]?.getAttribute('class')).toBe('res bad');
    expect(byClass(reveal, 'res')[0]?.textContent).toMatch(/loses the round$/);
    expect(reveal.textContent).toContain('Next round starts in 6s…');
    expect(byClass(root, 'turnbar')[0]?.textContent).toBe('Round over — see the reveal below');
    expect(byId(root, 'zoneTable')).toBeNull();
    fire(requireId(root, 'btnNext'), 'click');
    expect(intents()).toEqual([{ type: 'play', action: { type: 'next' } }]);
    const other = renderApp(SCENARIOS['game: revealed, someone else lost']).root;
    expect(byClass(requireId(other, 'reveal'), 'res')[0]?.getAttribute('class')).toBe('res good');
  });

  test('over, keeping score: the trophy, the scoreboard, no finish button', () => {
    const { root } = renderApp(SCENARIOS['game: over, scored']);
    const table = requireId(root, 'tableEl');
    expect(table.textContent).toContain('\u{1F3C6}');
    const rows = byClass(requireId(root, 'scoreboard'), 'score-row');
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => hasClass(r, 'top'))).toEqual([true, false, false, false]);
    expect(byClass(rows[0] ?? table, 'place')[0]?.textContent).toBe('\u{1F3C6}');
    expect(byClass(rows[1] ?? table, 'place')[0]?.textContent).toBe('2');
    expect(byClass(table, 'res')[0]?.textContent).toMatch(/wins!$|A tie at the top!/);
    expect(table.textContent).toContain('Leave the table to start a new game.');
    expect(byId(root, 'btnFinish')).toBeNull();
    expect(byId(root, 'reveal')).toBeNull();
  });

  test('over, kayaks: the last kayak line and the final reveal without a next button', () => {
    const { root } = renderApp(SCENARIOS['game: over, kayaks']);
    const table = requireId(root, 'tableEl');
    expect(table.textContent).toContain('Last kayak on the lake.');
    expect(byClass(table, 'res')[0]?.textContent).toMatch(/^(Ari|Tyler) wins!$/);
    requireId(root, 'reveal');
    expect(byId(root, 'btnNext')).toBeNull();
    expect(byId(root, 'scoreboard')).toBeNull();
    expect(byClass(root, 'lives')).toHaveLength(2);
    expect(byClass(root, 'seat').some((s) => hasClass(s, 'out'))).toBe(true);
  });
});

describe('gameScreen: pass the phone', () => {
  test('the cover hides the table and lifts on a tap', () => {
    const { root, intents } = renderApp(SCENARIOS['game: pass the phone, cover']);
    requireId(root, 'screen-game');
    const cover = requireId(root, 'handoffCover');
    expect(cover.getAttribute('role')).toBe('button');
    expect(cover.getAttribute('tabindex')).toBe('0');
    expect(byClass(cover, 'big')[0]?.textContent).toBe('Pass the phone to Tyler');
    expect(byId(root, 'tableEl')).toBeNull();
    expect(byClass(root, 'seat')).toEqual([]);
    fire(cover, 'click');
    expect(intents()).toEqual([{ type: 'handoff.tap' }]);
  });

  test('the confirm step names the player and confirms', () => {
    const { root, intents } = renderApp(SCENARIOS['game: pass the phone, confirm']);
    requireId(root, 'handoffConfirmWrap');
    const confirm = requireId(root, 'handoffConfirm');
    expect(confirm.textContent).toBe("I'm Tyler — show my turn");
    fire(confirm, 'click');
    expect(intents()).toEqual([{ type: 'handoff.confirm' }]);
  });
});
