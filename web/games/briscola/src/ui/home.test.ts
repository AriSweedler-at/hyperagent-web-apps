// No jsdom here (docs/ARCHITECTURE.md "Testing pyramid"): the home screen runs against the page
// fake built from the page's own markup (ui/page.fake.ts over web/games/briscola/index.html). The
// fake knows no `<option selected>`, so a test sets a select's value as a player would pick it.
import { describe, expect, test } from 'vitest';

import { fakeTarget } from '../../../../shared/edge/page.fake.ts';
import {
  EXTRA_NAME_INPUTS,
  bindHome,
  blocksCodeInput,
  fillNameInputs,
  fillP2NameInput,
  inviteUrl,
  paintHome,
  readHostOptions,
  readLocalOptions,
  setCodeInput,
  tabButtonId,
} from './home.ts';
import { briscolaPage, type BriscolaPage } from './page.fake.ts';
import { DEFAULT_OPTS, initialApp, type App, type Intent } from './state.ts';

import MARKUP from '../../index.html?raw';

/** The controls the owner took off the home screen (2026-09-25): the match select and the house rules, in both panels. */
const GONE_IDS = [
  'matchSel',
  'localMatchSel',
  'removedTwoSel',
  'localRemovedTwoSel',
  'exchangeChk',
  'localExchangeChk',
  'scopertaChk',
  'localScopertaChk',
  'partnerPeekChk',
  'localPartnerPeekChk',
];

const page = (): BriscolaPage => briscolaPage(MARKUP);
/** Type into an input, or pick a select's option, as the player would. */
const type = (p: BriscolaPage, id: string, value: string): void => {
  const input = p.get(id).el as HTMLInputElement;
  input.value = value;
};
const withOpts = (over: Partial<App['shell']['opts']>, table: Partial<App['table']> = {}): App => ({
  shell: { ...initialApp.shell, opts: { ...DEFAULT_OPTS, ...over } },
  table: { ...initialApp.table, ...table },
});
/** A page with both selects at their shipped default, as a browser would report it. */
const defaults = (p: BriscolaPage): void => {
  type(p, 'playersSel', '2');
  type(p, 'localPlayersSel', '2');
};
const recorder = (): Readonly<{ intents: Intent[]; dispatch: (i: Intent) => void }> => {
  const intents: Intent[] = [];
  return { intents, dispatch: (i) => intents.push(i) };
};

describe('the input writes the reducer raises as effects', () => {
  test('fillNameInputs writes both first-name inputs, fillP2NameInput the second seat, setCodeInput the code', () => {
    const p = page();
    fillNameInputs(p.doc, 'Ann');
    expect(p.get('nameInput').value()).toBe('Ann');
    expect(p.get('p1NameInput').value()).toBe('Ann');
    expect(p.get('p2NameInput').value()).toBe('');
    fillP2NameInput(p.doc, 'Bob');
    expect(p.get('p2NameInput').value()).toBe('Bob');
    expect(p.get('p1NameInput').value()).toBe('Ann');
    setCodeInput(p.doc, 'AB');
    expect(p.get('codeInput').value()).toBe('AB');
    // The shell's default fill marks its inputs for the first-tap clear; a plain fill unmarks.
    fillNameInputs(p.doc, 'Ari', true);
    fillP2NameInput(p.doc, 'Lavi', true);
    ['nameInput', 'p1NameInput', 'p2NameInput'].forEach((id) => {
      expect(p.get(id).attr('data-default'), id).toBe('1');
    });
    fillP2NameInput(p.doc, 'Bob');
    expect(p.get('p2NameInput').attr('data-default')).toBeNull();
    expect(p.get('p1NameInput').attr('data-default')).toBe('1');
  });
});

describe('pure helpers', () => {
  test('inviteUrl, tabButtonId and blocksCodeInput are the shared shell helpers', () => {
    expect(inviteUrl('KQZM', 'https://games.sweedler.com/briscola/')).toBe(
      'https://games.sweedler.com/briscola/?join=KQZM',
    );
    expect((['play', 'rules', 'about'] as const).map(tabButtonId)).toEqual([
      'tabPlayBtn',
      'tabRulesBtn',
      'tabAboutBtn',
    ]);
    expect(blocksCodeInput('insertReplacementText', null)).toBe(true);
    expect(blocksCodeInput('insertText', 'a')).toBe(false);
  });
});

describe('paintHome', () => {
  test('tabs, panels, the play mode, the resume box, and the room controls from the App', () => {
    const p = page();
    paintHome(p.doc, initialApp);
    expect(p.get('tabPlayBtn').hasClass('active')).toBe(true);
    expect(p.get('playPanel').hidden()).toBe(false);
    expect(p.get('rulesPanel').hidden()).toBe(true);
    expect(p.get('onlineModeContent').hidden()).toBe(false);
    expect(p.get('localModeContent').hidden()).toBe(true);
    expect(p.get('resumeBox').hidden()).toBe(true);
    // The default (D3): two players; the match and the house rules have no controls at all.
    expect(p.get('localPlayersSel').value()).toBe('2');
    GONE_IDS.forEach((id) => {
      expect(MARKUP).not.toContain(`id="${id}"`);
    });
    expect(MARKUP).not.toContain('house-rules');
    // Two seats: the third and fourth name inputs are put away.
    expect(p.get('moreNames').hidden()).toBe(true);
    expect(p.get(EXTRA_NAME_INPUTS[3]).hidden()).toBe(true);
    // The Online seat count is left as the page ships it (three and four are disabled there, D16).
    expect(p.get('playersSel').value()).toBe('');
  });

  test('three and four seats show the extra names, painted from the table`s memory', () => {
    const p = page();
    paintHome(p.doc, withOpts({ seatCount: 3 }, { extraNames: { 2: 'Cara', 3: 'Dan' } }));
    expect(p.get('localPlayersSel').value()).toBe('3');
    expect(p.get('moreNames').hidden()).toBe(false);
    expect(p.get(EXTRA_NAME_INPUTS[2]).hidden()).toBe(false);
    expect(p.get(EXTRA_NAME_INPUTS[3]).hidden()).toBe(true);
    expect(p.get(EXTRA_NAME_INPUTS[2]).value()).toBe('Cara');
    expect(p.get(EXTRA_NAME_INPUTS[3]).value()).toBe('Dan');
    // Remembered or typed names carry no mark.
    expect(p.get(EXTRA_NAME_INPUTS[2]).attr('data-default')).toBeNull();
    expect(p.get(EXTRA_NAME_INPUTS[3]).attr('data-default')).toBeNull();
    // Nothing remembered (null): the seat shows its default (the owner's Sandro and Grant), marked
    // for the first-tap clear; a seat emptied by that tap ('') shows empty, unmarked.
    paintHome(p.doc, withOpts({ seatCount: 4 }, { extraNames: { 2: null, 3: null } }));
    expect(p.get(EXTRA_NAME_INPUTS[2]).value()).toBe('Sandro');
    expect(p.get(EXTRA_NAME_INPUTS[3]).value()).toBe('Grant');
    expect(p.get(EXTRA_NAME_INPUTS[2]).attr('data-default')).toBe('1');
    expect(p.get(EXTRA_NAME_INPUTS[3]).attr('data-default')).toBe('1');
    paintHome(p.doc, withOpts({ seatCount: 4 }, { extraNames: { 2: '', 3: null } }));
    expect(p.get(EXTRA_NAME_INPUTS[2]).value()).toBe('');
    expect(p.get(EXTRA_NAME_INPUTS[2]).attr('data-default')).toBeNull();
    expect(p.get(EXTRA_NAME_INPUTS[3]).attr('data-default')).toBe('1');
    paintHome(p.doc, withOpts({ seatCount: 4 }));
    expect(p.get('localPlayersSel').value()).toBe('4');
    expect(p.get(EXTRA_NAME_INPUTS[3]).hidden()).toBe(false);
  });
});

describe('bindHome', () => {
  test('the start buttons carry the raw seat count of their panel (`Raw`), the extra names with Start', () => {
    const p = page();
    defaults(p);
    const r = recorder();
    bindHome(p.doc, r.dispatch);
    type(p, 'nameInput', 'Ann');
    p.get('hostBtn').fire('click');
    expect(r.intents).toEqual([{ type: 'host/click', name: 'Ann', players: '2' }]);
    expect(readHostOptions(p.doc)).toEqual({ players: '2' });
    type(p, 'p1NameInput', 'Ann');
    type(p, 'p2NameInput', 'Bob');
    type(p, 'localPlayersSel', '3');
    type(p, EXTRA_NAME_INPUTS[2], 'Cara');
    p.get('localBtn').fire('click');
    expect(r.intents.at(-1)).toEqual({
      type: 'local/click',
      p1: 'Ann',
      p2: 'Bob',
      localPlayers: '3',
      p3: 'Cara',
      p4: '',
    });
    expect(readLocalOptions(p.doc).p3).toBe('Cara');
  });

  test('a changed select remembers its panel`s count at once; the third and fourth names as typed', () => {
    const p = page();
    defaults(p);
    const r = recorder();
    bindHome(p.doc, r.dispatch);
    type(p, 'localPlayersSel', '4');
    p.get('localPlayersSel').fire('change');
    expect(r.intents).toEqual([{ type: 'opts/set', raw: { localPlayers: '4' } }]);
    p.get('playersSel').fire('change');
    expect(r.intents.at(-1)).toEqual({ type: 'opts/set', raw: { players: '2' } });
    type(p, EXTRA_NAME_INPUTS[2], 'Cara');
    p.get(EXTRA_NAME_INPUTS[2]).fire('input');
    type(p, EXTRA_NAME_INPUTS[3], 'Dan ');
    p.get(EXTRA_NAME_INPUTS[3]).fire('input');
    expect(r.intents.slice(-2)).toEqual([
      { type: 'pname/typed', seat: 2, value: 'Cara' },
      { type: 'pname/typed', seat: 3, value: 'Dan ' },
    ]);
    // A third or fourth seat showing its default (painted marked) clears on its first tap and
    // tells the reducer the seat is empty; the second tap, and a tap on a typed name, do nothing.
    paintHome(p.doc, withOpts({ seatCount: 4 }, { extraNames: { 2: null, 3: null } }));
    const before = r.intents.length;
    p.get(EXTRA_NAME_INPUTS[2]).fire('focus');
    expect(p.get(EXTRA_NAME_INPUTS[2]).value()).toBe('');
    expect(p.get(EXTRA_NAME_INPUTS[2]).attr('data-default')).toBeNull();
    p.get(EXTRA_NAME_INPUTS[2]).fire('focus');
    p.get(EXTRA_NAME_INPUTS[2]).fire('pointerdown');
    expect(r.intents.slice(before)).toEqual([{ type: 'pname/typed', seat: 2, value: '' }]);
    p.get(EXTRA_NAME_INPUTS[3]).fire('pointerdown');
    expect(p.get(EXTRA_NAME_INPUTS[3]).value()).toBe('');
    expect(r.intents.slice(before)).toEqual([
      { type: 'pname/typed', seat: 2, value: '' },
      { type: 'pname/typed', seat: 3, value: '' },
    ]);
    // The shell's own controls are bound through the shared binder: a tab click, for one.
    p.get('tabRulesBtn').fire('click', { target: fakeTarget({ id: 'tabRulesBtn' }) });
    expect(r.intents.at(-1)).toEqual({ type: 'tab/set', tab: 'rules' });
  });
});
