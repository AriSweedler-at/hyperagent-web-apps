import { describe, expect, test } from 'vitest';

import { mulberry32 } from '../../../../shared/lib/rng.ts';
import { applyAction, createGame } from '../engine/index.ts';
import type { State } from '../engine/index.ts';
import { bindLocal, curtainText, paintCurtain } from './local.ts';
import { ginPage } from './page.fake.ts';
import { initialApp, type Intent } from './state.ts';

import MARKUP from '../../index.html?raw';
const NOW = 1_700_000_000_000;
const game = createGame(
  {
    players: [
      { id: 'p1', name: 'Ann' },
      { id: 'p2', name: 'Bob' },
    ],
    target: 100,
    dealer: 1,
  },
  mulberry32(5),
  () => NOW,
);
const passed: State = (() => {
  const r = applyAction(game, 0, { type: 'passUpcard' }, mulberry32(0), () => NOW);
  if (!r.ok) throw new Error(r.error);
  return r.value;
})();

describe('curtainText', () => {
  test('names who takes the phone, who looks away, the last move and the button', () => {
    expect(curtainText(game, 0)).toEqual({
      title: 'Pass the phone to Ann',
      sub: 'Bob, look away 👀',
      last: 'Bob dealt hand 1. Ann may take the upcard or pass.',
      button: "I'm Ann — show my cards",
    });
    expect(curtainText({ ...game, lastAction: null }, 0).last).toBe('');
    expect(curtainText(passed, 1)).toEqual({
      title: 'Pass the phone to Bob',
      sub: 'Ann, look away 👀',
      last: passed.lastAction?.text,
      button: "I'm Bob — show my cards",
    });
    expect(passed.lastAction?.text).toMatch(/^Ann passed on the upcard\./);
  });
});

describe('paintCurtain', () => {
  test('shows the curtain with its texts for the waiting seat; hides it, texts untouched, otherwise', () => {
    const page = ginPage(MARKUP);
    paintCurtain(page.doc, {
      ...initialApp,
      shell: { ...initialApp.shell, role: 'local', game: passed },
      table: { ...initialApp.table, curtain: 1 },
    });
    expect(page.get('curtainOverlay').hidden()).toBe(false);
    expect(page.get('curtainTitle').text()).toBe('Pass the phone to Bob');
    expect(page.get('curtainSub').text()).toBe('Ann, look away 👀');
    expect(page.get('curtainLast').text()).toBe(passed.lastAction?.text);
    expect(page.get('curtainBtn').text()).toBe("I'm Bob — show my cards");
    paintCurtain(page.doc, {
      ...initialApp,
      shell: { ...initialApp.shell, role: 'local', game: passed },
      table: { ...initialApp.table, curtain: null },
    });
    expect(page.get('curtainOverlay').hidden()).toBe(true);
    expect(page.get('curtainTitle').text()).toBe('Pass the phone to Bob');
    // A curtain without a game (unreachable) is not shown.
    paintCurtain(page.doc, { ...initialApp, table: { ...initialApp.table, curtain: 0 } });
    expect(page.get('curtainOverlay').hidden()).toBe(true);
  });
});

describe('bindLocal', () => {
  test('the curtain button reveals', () => {
    const page = ginPage(MARKUP);
    const intents: Intent[] = [];
    bindLocal(page.doc, (i) => {
      intents.push(i);
    });
    page.get('curtainBtn').fire('click');
    expect(intents).toEqual([{ type: 'curtain/reveal' }]);
  });
});
