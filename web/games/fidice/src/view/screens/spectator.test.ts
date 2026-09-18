// The spectator screen on the fake DOM: the cup and bid cards by id, the true-hand toggle, the
// marked ladder, the host bar for a table of computers, and the leave/close button.
import { describe, expect, test } from 'vitest';

import { spokenName } from '../../domain/hands.ts';
import { byClass, byId, fire, hasClass, requireId } from '../../../../../shared/edge/dom.fake.ts';
import { renderApp } from '../render.fake.ts';
import { CODE, FIRST_BID, SCENARIOS } from '../scenarios.ts';

const diceIn = (root: ReturnType<typeof renderApp>['root'], id: string): ReadonlyArray<string> =>
  byClass(requireId(root, id), 'die').map((d) => d.getAttribute('class') ?? '');

describe('spectatorScreen', () => {
  test('hosting a table of computers: the host bar, close, seats, waiting texts', () => {
    const { root, intents } = renderApp(SCENARIOS['spec: hosting a table of computers']);
    requireId(root, 'screen-spec');
    const bar = requireId(root, 'specHostBar');
    expect(bar.textContent).toContain(`4/6 seated \xB7 code ${CODE}`);
    const [add, start] = byClass(bar, 'btn-secondary').concat(byClass(bar, 'btn-primary'));
    expect(add?.disabled).toBe(false);
    expect(start?.disabled).toBe(false);
    expect(requireId(root, 'btnLeaveSpec').textContent).toBe('Close table');
    expect(requireId(root, 'specCupWho').textContent).toBe('Waiting for the game to start');
    expect(requireId(root, 'specCupStage').textContent).toBe('4 players seated');
    expect(requireId(root, 'specOutDice').textContent).toBe('none');
    expect(requireId(root, 'specCupDice').textContent).toBe('empty');
    expect(requireId(root, 'specBidName').textContent).toBe('No bid yet');
    expect(requireId(root, 'specBidHist').textContent).toBe('—');
    requireId(root, 'specLadder');
    requireId(root, 'spec-log');
    expect(byClass(requireId(root, 'specPlayers'), 'seat')).toHaveLength(4);
    if (add) fire(add, 'click');
    if (start) fire(start, 'click');
    fire(requireId(root, 'btnLeaveSpec'), 'click');
    expect(intents()).toEqual([
      { type: 'lobby.addBot' },
      { type: 'lobby.start' },
      { type: 'leave' },
    ]);
  });

  test('a spectator in the lobby: the watching banner, leave, no host bar', () => {
    const { root } = renderApp(SCENARIOS['spec: lobby']);
    expect(byId(root, 'specHostBar')).toBeNull();
    expect(requireId(root, 'specBanner').textContent).toBe(
      "\u{1F440} You're watching. Nothing you do here affects the game.",
    );
    expect(requireId(root, 'btnLeaveSpec').textContent).toBe('Leave');
    expect(requireId(renderApp(SCENARIOS['spec: busy']).root, 'specBanner').textContent).toBe(
      'Connecting…',
    );
  });

  test('playing with the truth hidden: public dice shown, cup dice hidden, the bid and its history', () => {
    const { root, intents } = renderApp(SCENARIOS['spec: playing, truth hidden']);
    expect(requireId(root, 'specCupWho').textContent).toBe('Tyler has the cup');
    expect(requireId(root, 'specCupStage').textContent).toBe('Accepted the cup — must raise');
    expect(diceIn(root, 'specOutDice').every((c) => /^die sm v[1-6]$/.test(c))).toBe(true);
    expect(diceIn(root, 'specOutDice')).toHaveLength(2);
    expect(diceIn(root, 'specCupDice')).toEqual(Array<string>(3).fill('die sm hidden-face'));
    expect(requireId(root, 'truthToggle').checked).toBe(false);
    expect(requireId(root, 'specTruth').textContent).toBe('');
    expect(requireId(root, 'specBidName').textContent).toBe(spokenName(FIRST_BID));
    expect(requireId(root, 'specBidWho').textContent).toBe('by Ari \xB7 rung 41 of 252');
    expect(diceIn(root, 'specBidDice')).toHaveLength(5);
    const history = requireId(root, 'specBidHist');
    expect(history.childNodes).toHaveLength(1);
    const current = history.childNodes[0];
    expect(current && 'getAttribute' in current && current.getAttribute('class')).toBe('cur');
    expect(current?.textContent).toBe(`Ari${spokenName(FIRST_BID)}`);
    // The ladder marks the bid and dims the rows at or below it.
    const ladder = requireId(root, 'specLadder');
    expect(ladder.getAttribute('style')).toBe('max-height:78vh;overflow:auto');
    expect(byClass(ladder, 'mark-bid').length).toBeGreaterThan(0);
    expect(byClass(ladder, 'dim').length).toBeGreaterThan(0);
    expect(byClass(ladder, 'mark-cup')).toEqual([]);
    fire(requireId(root, 'truthToggle'), 'change', { checked: true });
    expect(intents()).toEqual([{ type: 'spec.truth', on: true }]);
  });

  test('the truth shown: cup faces, the true hand line and the cup marker on the ladder', () => {
    const { root } = renderApp(SCENARIOS['spec: playing, truth shown']);
    expect(diceIn(root, 'specCupDice').every((c) => /^die sm v[1-6]$/.test(c))).toBe(true);
    expect(requireId(root, 'truthToggle').checked).toBe(true);
    expect(requireId(root, 'specTruth').textContent).toMatch(
      /^True hand: .+ — bid (holds|is a lie)$/,
    );
    const ladder = requireId(root, 'specLadder');
    expect(byClass(ladder, 'tab-marker').some((m) => hasClass(m, 'cup'))).toBe(true);
  });

  test('revealed and over: the cup card says so', () => {
    const revealed = renderApp(SCENARIOS['spec: revealed']).root;
    expect(requireId(revealed, 'specCupWho').textContent).toBe('Cup lifted!');
    expect(requireId(revealed, 'specCupStage').textContent).toMatch(/^.+ called Tyler$/);
    expect(requireId(revealed, 'specTruth').textContent).toMatch(/^True hand: /);
    const over = renderApp(SCENARIOS['spec: over']).root;
    expect(requireId(over, 'specCupWho').textContent).toMatch(/^\u{1F3C6} /u);
  });
});
