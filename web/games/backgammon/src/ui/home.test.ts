// No jsdom here (docs/ARCHITECTURE.md "Testing pyramid"): the home screen runs against the page
// fake built from the page's own markup (ui/page.fake.ts over web/games/backgammon/index.html).
import { describe, expect, test } from 'vitest';

import { fakeTarget } from '../../../../shared/edge/page.fake.ts';
import {
  bindHome,
  blocksCodeInput,
  fillNameInputs,
  fillP2NameInput,
  inviteUrl,
  paintHome,
  setCodeInput,
  tabButtonId,
} from './home.ts';
import { backgammonPage, type BackgammonPage } from './page.fake.ts';
import { initialApp, type App, type Intent } from './state.ts';

import MARKUP from '../../index.html?raw';
const page = (): BackgammonPage => backgammonPage(MARKUP);
/** Type into an input as the player would (the fake's inputs carry a writable value). */
const type = (p: BackgammonPage, id: string, value: string): void => {
  const input = p.get(id).el as HTMLInputElement;
  input.value = value;
};
const shell = (over: Partial<App['shell']>): App => ({
  ...initialApp,
  shell: { ...initialApp.shell, ...over },
});

describe('the input writes the reducer raises as effects', () => {
  test('fillNameInputs writes both first-name inputs, fillP2NameInput the second seat, setCodeInput the code', () => {
    const p = page();
    expect(p.get('nameInput').value()).toBe('Ari');
    fillNameInputs(p.doc, 'Ann');
    expect(p.get('nameInput').value()).toBe('Ann');
    expect(p.get('p1NameInput').value()).toBe('Ann');
    expect(p.get('p2NameInput').value()).toBe('');
    fillP2NameInput(p.doc, 'Bob');
    expect(p.get('p2NameInput').value()).toBe('Bob');
    expect(p.get('p1NameInput').value()).toBe('Ann');
    setCodeInput(p.doc, 'AB');
    expect(p.get('codeInput').value()).toBe('AB');
  });
});

describe('pure helpers', () => {
  test('inviteUrl is the page with the code to join, and nothing else', () => {
    expect(inviteUrl('KQZM', 'https://games.sweedler.com/backgammon/')).toBe(
      'https://games.sweedler.com/backgammon/?join=KQZM',
    );
  });

  test('tabButtonId capitalises the tab', () => {
    expect((['play', 'rules', 'about'] as const).map(tabButtonId)).toEqual([
      'tabPlayBtn',
      'tabRulesBtn',
      'tabAboutBtn',
    ]);
  });

  test('blocksCodeInput refuses replacements and multi-character inserts only', () => {
    expect(blocksCodeInput('insertReplacementText', null)).toBe(true);
    expect(blocksCodeInput('insertText', 'ab')).toBe(true);
    expect(blocksCodeInput('insertText', 'a')).toBe(false);
    expect(blocksCodeInput('insertText', null)).toBe(false);
    expect(blocksCodeInput('deleteContentBackward', null)).toBe(false);
  });
});

describe('paintHome', () => {
  test('tabs, panels, the play mode, the selects, the submenu and the resume box from the App', () => {
    const p = page();
    paintHome(p.doc, initialApp);
    expect(p.get('tabPlayBtn').hasClass('active')).toBe(true);
    expect(p.get('tabRulesBtn').hasClass('active')).toBe(false);
    expect(p.get('playPanel').hidden()).toBe(false);
    expect(p.get('rulesPanel').hidden()).toBe(true);
    expect(p.get('aboutPanel').hidden()).toBe(true);
    // Online is the default mode (storage.ts DEFAULT_PLAY_MODE, as gin's); both options show.
    expect(p.get('onlineModeContent').hidden()).toBe(false);
    expect(p.get('localModeContent').hidden()).toBe(true);
    expect(p.modeButtons.map((b) => b.hasClass('active'))).toEqual([true, false]);
    expect(p.modeButtons.map((b) => b.hidden())).toEqual([false, false]);
    expect(p.get('playModeSwitch').hidden()).toBe(false);
    expect(p.submenuButtons.map((b) => b.hasClass('active'))).toEqual([true, false]);
    expect(p.submenuButtons.map((b) => b.hidden())).toEqual([false, false]);
    expect(p.get('matchLengthSel').value()).toBe('5');
    expect(p.get('localMatchLengthSel').value()).toBe('5');
    expect(p.get('variantSel').value()).toBe('portes');
    expect(p.get('localVariantSel').value()).toBe('portes');
    expect(p.get('playSubmenu').hasClass('force-open')).toBe(false);
    expect(p.get('resumeBox').hidden()).toBe(true);

    paintHome(
      p.doc,
      shell({
        playMode: 'local',
        submenuOpen: true,
        matchLength: 3,
        variant: 'backgammon',
        resume: { kind: 'guest', code: 'KQZM', myName: 'Jo' },
      }),
    );
    expect(p.get('onlineModeContent').hidden()).toBe(true);
    expect(p.get('localModeContent').hidden()).toBe(false);
    expect(p.modeButtons.map((b) => b.hasClass('active'))).toEqual([false, true]);
    expect(p.get('matchLengthSel').value()).toBe('3');
    expect(p.get('localVariantSel').value()).toBe('backgammon');
    expect(p.get('playSubmenu').hasClass('force-open')).toBe(true);
    expect(p.get('resumeBox').hidden()).toBe(false);
    expect(p.get('resumeBtn').text()).toBe('Rejoin room KQZM');
  });

  test("another tab leaves the mode marks as they were (gin's renderPlayMode trait)", () => {
    const p = page();
    paintHome(p.doc, shell({ homeTab: 'rules', playMode: 'local' }));
    expect(p.get('tabRulesBtn').hasClass('active')).toBe(true);
    expect(p.get('rulesPanel').hidden()).toBe(false);
    expect(p.get('playPanel').hidden()).toBe(true);
    // The markup's marks (Online active, the local panel hidden) stand until the Play tab paints.
    expect(p.get('localModeContent').hidden()).toBe(true);
    expect(p.modeButtons.map((b) => b.hasClass('active'))).toEqual([true, false]);
    paintHome(p.doc, shell({ homeTab: 'about' }));
    expect(p.get('aboutPanel').hidden()).toBe(false);
  });
});

describe('bindHome', () => {
  const wired = (): Readonly<{ p: BackgammonPage; intents: Intent[] }> => {
    const p = page();
    const intents: Intent[] = [];
    bindHome(p.doc, (i) => {
      intents.push(i);
    });
    return { p, intents };
  };

  test('the inputs, selects and buttons dispatch with the raw values', () => {
    const { p, intents } = wired();
    type(p, 'nameInput', ' Ann ');
    p.get('nameInput').fire('input');
    type(p, 'p1NameInput', 'Zoë');
    p.get('p1NameInput').fire('input');
    type(p, 'p2NameInput', 'Bob');
    p.get('p2NameInput').fire('input');
    type(p, 'matchLengthSel', '3');
    type(p, 'variantSel', 'backgammon');
    p.get('hostBtn').fire('click');
    type(p, 'codeInput', 'abcd');
    p.get('joinBtn').fire('click');
    p.get('codeInput').fire('keydown', { key: 'Enter' });
    p.get('codeInput').fire('keydown', { key: 'a' });
    p.get('startGameBtn').fire('click');
    type(p, 'localMatchLengthSel', '7');
    type(p, 'localVariantSel', 'portes');
    p.get('localBtn').fire('click');
    p.get('matchLengthSel').fire('change', { target: fakeTarget({ value: '1' }) });
    p.get('localVariantSel').fire('change', { target: fakeTarget({ value: 'backgammon' }) });
    p.get('tabRulesBtn').fire('click');
    p.get('tabAboutBtn').fire('click');
    p.get('resumeBtn').fire('click');
    p.get('shareCodeBtn').fire('click');
    p.get('cancelHostBtn').fire('click');
    p.get('cancelGuestBtn').fire('click');
    expect(intents).toEqual([
      { type: 'name/typed', value: ' Ann ' },
      { type: 'p1name/typed', value: 'Zoë' },
      { type: 'p2name/typed', value: 'Bob' },
      { type: 'host/click', name: ' Ann ', matchLength: '3', variant: 'backgammon' },
      { type: 'join/click', name: ' Ann ', code: 'abcd' },
      { type: 'join/click', name: ' Ann ', code: 'abcd' },
      { type: 'host/deal' },
      { type: 'local/click', p1: 'Zoë', p2: 'Bob', matchLength: '7', variant: 'portes' },
      { type: 'matchLength/set', length: '1' },
      { type: 'variant/set', variant: 'backgammon' },
      { type: 'tab/set', tab: 'rules' },
      { type: 'tab/set', tab: 'about' },
      { type: 'resume/click' },
      { type: 'share/click' },
      { type: 'cancel' },
      { type: 'cancel' },
    ]);
  });

  test('the code input: the beforeinput guard, and what is typed with its inputType', () => {
    const { p, intents } = wired();
    const blocked = p
      .get('codeInput')
      .fire('beforeinput', { inputType: 'insertReplacementText', data: 'ABCD' });
    expect(blocked.wasPrevented()).toBe(true);
    const allowed = p.get('codeInput').fire('beforeinput', { inputType: 'insertText', data: 'a' });
    expect(allowed.wasPrevented()).toBe(false);
    p.get('codeInput').fire('input', {
      inputType: 'insertText',
      target: fakeTarget({ value: 'ab' }),
    });
    expect(intents).toEqual([{ type: 'code/typed', value: 'ab', inputType: 'insertText' }]);
  });

  test('the mode buttons, the Play tab and its submenu, and the dismiss on a click elsewhere', () => {
    const { p, intents } = wired();
    p.modeButtons.forEach((b) => {
      b.fire('click');
    });
    p.get('tabPlayBtn').fire('pointerdown');
    p.get('tabPlayBtn').fire('pointerup');
    p.get('tabPlayBtn').fire('pointerleave');
    p.get('tabPlayBtn').fire('pointercancel');
    p.get('tabPlayBtn').fire('click');
    const pick = p.submenuButtons[1]?.fire('click');
    expect(pick?.wasStopped()).toBe(true);
    p.fire('click', { target: p.get('tabRulesBtn').el });
    // Inside the Play tab's wrap (the fake declares no children, so the wrap itself stands in).
    p.fire('click', { target: p.get('tabPlayWrap').el });
    expect(intents).toEqual([
      { type: 'mode/set', mode: 'online' },
      { type: 'mode/set', mode: 'local' },
      { type: 'submenu/press' },
      { type: 'submenu/release' },
      { type: 'submenu/release' },
      { type: 'submenu/release' },
      { type: 'tab/playClick' },
      { type: 'submenu/pick', mode: 'local' },
      { type: 'submenu/dismiss' },
    ]);
  });
});
