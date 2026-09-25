// No jsdom here (docs/ARCHITECTURE.md "Testing pyramid"): the home screen runs against the page
// fake built from the page's own markup (ui/page.fake.ts over web/games/briscola/index.html). The
// fake knows no `<option selected>`, so a test sets a select's value as a player would pick it.
import { describe, expect, test } from 'vitest';

import { setChecked } from '../../../../shared/edge/dom.ts';
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
/** A page with every select at its shipped default, as a browser would report it. */
const defaults = (p: BriscolaPage): void => {
  type(p, 'playersSel', '2');
  type(p, 'matchSel', '2');
  type(p, 'removedTwoSel', 'C');
  type(p, 'localPlayersSel', '2');
  type(p, 'localMatchSel', '2');
  type(p, 'localRemovedTwoSel', 'C');
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
    // The defaults (D3): two players, best of three, the 2 di coppe out, every house rule off.
    expect(p.get('localPlayersSel').value()).toBe('2');
    expect(p.get('matchSel').value()).toBe('2');
    expect(p.get('localMatchSel').value()).toBe('2');
    expect(p.get('removedTwoSel').value()).toBe('C');
    expect(p.get('localRemovedTwoSel').value()).toBe('C');
    expect(p.get('exchangeChk').checked()).toBe(false);
    expect(p.get('localScopertaChk').checked()).toBe(false);
    // Two seats: the third and fourth name inputs are put away.
    expect(p.get('moreNames').hidden()).toBe(true);
    expect(p.get(EXTRA_NAME_INPUTS[3]).hidden()).toBe(true);
    // The Online seat count is left as the page ships it (three and four are disabled there, D16).
    expect(p.get('playersSel').value()).toBe('');
  });

  test('three and four seats show the extra names, painted from the table`s memory; the switches follow the terms', () => {
    const p = page();
    paintHome(
      p.doc,
      withOpts(
        { seatCount: 3, gamesToWin: 1, removedTwo: 'S', exchange: true },
        { extraNames: { 2: 'Cara', 3: 'Dan' } },
      ),
    );
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
    paintHome(
      p.doc,
      withOpts(
        { seatCount: 3, gamesToWin: 1, removedTwo: 'S', exchange: true },
        { extraNames: { 2: 'Cara', 3: 'Dan' } },
      ),
    );
    expect(p.get('localMatchSel').value()).toBe('1');
    expect(p.get('localRemovedTwoSel').value()).toBe('S');
    expect(p.get('exchangeChk').checked()).toBe(true);
    expect(p.get('localExchangeChk').checked()).toBe(true);
    paintHome(p.doc, withOpts({ seatCount: 4, partnerPeek: true }));
    expect(p.get(EXTRA_NAME_INPUTS[3]).hidden()).toBe(false);
    expect(p.get('localPartnerPeekChk').checked()).toBe(true);
    expect(p.get('exchangeChk').checked()).toBe(false);
  });
});

describe('bindHome', () => {
  test('the start buttons carry the raw terms of their panel (`Raw`), the switches as on/off, the extra names with Start', () => {
    const p = page();
    defaults(p);
    const r = recorder();
    bindHome(p.doc, r.dispatch);
    type(p, 'nameInput', 'Ann');
    setChecked(p.get('exchangeChk').el, true);
    p.get('hostBtn').fire('click');
    expect(r.intents).toEqual([
      {
        type: 'host/click',
        name: 'Ann',
        players: '2',
        match: '2',
        removedTwo: 'C',
        exchange: 'on',
        scoperta: 'off',
        partnerPeek: 'off',
      },
    ]);
    expect(readHostOptions(p.doc)).toEqual({
      players: '2',
      match: '2',
      removedTwo: 'C',
      exchange: 'on',
      scoperta: 'off',
      partnerPeek: 'off',
    });
    type(p, 'p1NameInput', 'Ann');
    type(p, 'p2NameInput', 'Bob');
    type(p, 'localPlayersSel', '3');
    type(p, 'localMatchSel', '1');
    type(p, 'localRemovedTwoSel', 'D');
    type(p, EXTRA_NAME_INPUTS[2], 'Cara');
    setChecked(p.get('localScopertaChk').el, true);
    p.get('localBtn').fire('click');
    expect(r.intents.at(-1)).toEqual({
      type: 'local/click',
      p1: 'Ann',
      p2: 'Bob',
      localPlayers: '3',
      localMatch: '1',
      localRemovedTwo: 'D',
      localExchange: 'off',
      localScoperta: 'on',
      localPartnerPeek: 'off',
      p3: 'Cara',
      p4: '',
    });
    expect(readLocalOptions(p.doc).p3).toBe('Cara');
  });

  test('a changed control remembers its panel`s terms at once; the third and fourth names as typed', () => {
    const p = page();
    defaults(p);
    const r = recorder();
    bindHome(p.doc, r.dispatch);
    type(p, 'localPlayersSel', '4');
    p.get('localPlayersSel').fire('change');
    expect(r.intents).toEqual([
      {
        type: 'opts/set',
        raw: {
          localPlayers: '4',
          localMatch: '2',
          localRemovedTwo: 'C',
          localExchange: 'off',
          localScoperta: 'off',
          localPartnerPeek: 'off',
        },
      },
    ]);
    setChecked(p.get('partnerPeekChk').el, true);
    p.get('partnerPeekChk').fire('change');
    expect(r.intents.at(-1)).toEqual({
      type: 'opts/set',
      raw: {
        players: '2',
        match: '2',
        removedTwo: 'C',
        exchange: 'off',
        scoperta: 'off',
        partnerPeek: 'on',
      },
    });
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
