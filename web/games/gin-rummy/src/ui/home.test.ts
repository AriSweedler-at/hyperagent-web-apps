// No jsdom here (docs/ARCHITECTURE.md "Testing pyramid"): the home screen runs against the page
// fake built from the page's own markup (ui/page.fake.ts over web/games/gin-rummy/index.html).
import { describe, expect, test } from 'vitest';

import { fakeTarget } from '../../../../shared/edge/page.fake.ts';
import {
  bindHome,
  blocksCodeInput,
  fillNameInputs,
  fillP2NameInput,
  inviteText,
  paintHome,
  setCodeInput,
  tabButtonId,
} from './home.ts';
import { ginPage, type GinPage } from './page.fake.ts';
import { initialApp, type Intent } from './state.ts';

import MARKUP from '../../index.html?raw';
const page = (): GinPage => ginPage(MARKUP);
/** Type into an input as the player would (the fake's inputs carry a writable value). */
const type = (p: GinPage, id: string, value: string): void => {
  const input = p.get(id).el as HTMLInputElement;
  input.value = value;
};

describe('the input writes the reducer raises as effects', () => {
  test('fillNameInputs writes both name inputs, fillP2NameInput the second; setCodeInput the code field', () => {
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
  test('inviteText is the legacy share text', () => {
    expect(inviteText('KQZM', 'https://games.sweedler.com/gin-rummy/')).toBe(
      'Join my Gin Rummy game — room code KQZM. Open https://games.sweedler.com/gin-rummy/ and tap Join.',
    );
  });

  test('tabButtonId capitalises the tab', () => {
    expect(['play', 'rules', 'score'].map((t) => tabButtonId(t as 'play'))).toEqual([
      'tabPlayBtn',
      'tabRulesBtn',
      'tabScoreBtn',
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
  test('tabs, panels, play mode, submenu and the resume box from the App', () => {
    const p = page();
    paintHome(p.doc, initialApp);
    expect(p.get('tabPlayBtn').hasClass('active')).toBe(true);
    expect(p.get('tabRulesBtn').hasClass('active')).toBe(false);
    expect(p.get('playPanel').hidden()).toBe(false);
    expect(p.get('rulesPanel').hidden()).toBe(true);
    expect(p.get('scorePanel').hidden()).toBe(true);
    expect(p.get('onlineModeContent').hidden()).toBe(false);
    expect(p.get('localModeContent').hidden()).toBe(true);
    expect(p.modeButtons.map((b) => b.hasClass('active'))).toEqual([true, false]);
    expect(p.submenuButtons.map((b) => b.hasClass('active'))).toEqual([true, false]);
    expect(p.get('playSubmenu').hasClass('force-open')).toBe(false);
    expect(p.get('resumeBox').hidden()).toBe(true);

    paintHome(p.doc, {
      ...initialApp,
      playMode: 'local',
      submenuOpen: true,
      resume: { kind: 'guest', code: 'KQZM', myName: 'Jo' },
    });
    expect(p.get('onlineModeContent').hidden()).toBe(true);
    expect(p.get('localModeContent').hidden()).toBe(false);
    expect(p.modeButtons.map((b) => b.hasClass('active'))).toEqual([false, true]);
    expect(p.submenuButtons.map((b) => b.hasClass('active'))).toEqual([false, true]);
    expect(p.get('playSubmenu').hasClass('force-open')).toBe(true);
    expect(p.get('resumeBox').hidden()).toBe(false);
    expect(p.get('resumeBtn').text()).toBe('Rejoin room KQZM');
  });

  test('renderPlayMode ran only on the Play tab: another tab leaves the mode marks as they were', () => {
    const p = page();
    paintHome(p.doc, { ...initialApp, homeTab: 'rules', playMode: 'local' });
    expect(p.get('tabRulesBtn').hasClass('active')).toBe(true);
    expect(p.get('rulesPanel').hidden()).toBe(false);
    expect(p.get('playPanel').hidden()).toBe(true);
    expect(p.get('localModeContent').hidden()).toBe(true);
    expect(p.modeButtons.map((b) => b.hasClass('active'))).toEqual([false, false]);
    expect(p.submenuButtons.map((b) => b.hasClass('active'))).toEqual([false, false]);
    paintHome(p.doc, { ...initialApp, homeTab: 'score' });
    expect(p.get('scorePanel').hidden()).toBe(false);
  });
});

describe('bindHome', () => {
  const wired = (): Readonly<{ p: GinPage; intents: Intent[] }> => {
    const p = page();
    const intents: Intent[] = [];
    bindHome(p.doc, (i) => {
      intents.push(i);
    });
    return { p, intents };
  };

  test('the inputs and buttons dispatch with the raw input values', () => {
    const { p, intents } = wired();
    type(p, 'nameInput', ' Ann ');
    p.get('nameInput').fire('input');
    type(p, 'p1NameInput', 'Zoë');
    p.get('p1NameInput').fire('input');
    type(p, 'targetInput', '75');
    p.get('hostBtn').fire('click');
    type(p, 'codeInput', 'abcd');
    p.get('joinBtn').fire('click');
    p.get('codeInput').fire('keydown', { key: 'Enter' });
    p.get('codeInput').fire('keydown', { key: 'a' });
    p.get('startGameBtn').fire('click');
    type(p, 'p2NameInput', 'Bob');
    p.get('p2NameInput').fire('input');
    type(p, 'localTargetInput', '50');
    p.get('localBtn').fire('click');
    p.get('tabRulesBtn').fire('click');
    p.get('tabScoreBtn').fire('click');
    p.modeButtons[1]?.fire('click');
    p.get('resumeBtn').fire('click');
    p.get('shareCodeBtn').fire('click');
    p.get('cancelHostBtn').fire('click');
    p.get('cancelGuestBtn').fire('click');
    expect(intents).toEqual([
      { type: 'name/typed', value: ' Ann ' },
      { type: 'p1name/typed', value: 'Zoë' },
      { type: 'host/click', name: ' Ann ', target: '75' },
      { type: 'join/click', name: ' Ann ', code: 'abcd' },
      { type: 'join/click', name: ' Ann ', code: 'abcd' },
      { type: 'host/deal' },
      { type: 'p2name/typed', value: 'Bob' },
      { type: 'local/click', p1: 'Zoë', p2: 'Bob', target: '50' },
      { type: 'tab/set', tab: 'rules' },
      { type: 'tab/set', tab: 'score' },
      { type: 'mode/set', mode: 'local' },
      { type: 'resume/click' },
      { type: 'share/click' },
      { type: 'cancel' },
      { type: 'cancel' },
    ]);
  });

  test('the code input: beforeinput blocks suggestions, input reports the value and type', () => {
    const { p, intents } = wired();
    const code = p.get('codeInput');
    expect(code.fire('beforeinput', { inputType: 'insertText', data: 'a' }).wasPrevented()).toBe(
      false,
    );
    expect(code.fire('beforeinput', { inputType: 'insertText', data: 'ab' }).wasPrevented()).toBe(
      true,
    );
    expect(code.fire('beforeinput', { inputType: 'insertReplacementText' }).wasPrevented()).toBe(
      true,
    );
    code.fire('input', { target: fakeTarget({ value: 'ab' }), inputType: 'insertText' });
    expect(intents).toEqual([{ type: 'code/typed', value: 'ab', inputType: 'insertText' }]);
  });

  test('the Play tab and its submenu: press, release, click, pick, and clicks elsewhere', () => {
    const { p, intents } = wired();
    const tab = p.get('tabPlayBtn');
    tab.fire('pointerdown');
    tab.fire('pointerup');
    tab.fire('pointerleave');
    tab.fire('pointercancel');
    tab.fire('click');
    const pick = p.submenuButtons[1]?.fire('click');
    expect(pick?.wasStopped()).toBe(true);
    // The document-level click: inside the Play tab's wrap it is ignored, outside it dismisses.
    p.fire('click', { target: p.get('tabPlayWrap').el });
    p.fire('click', { target: p.get('nameInput').el });
    p.fire('click');
    expect(intents).toEqual([
      { type: 'submenu/press' },
      { type: 'submenu/release' },
      { type: 'submenu/release' },
      { type: 'submenu/release' },
      { type: 'tab/playClick' },
      { type: 'submenu/pick', mode: 'local' },
      { type: 'submenu/dismiss' },
      { type: 'submenu/dismiss' },
    ]);
  });
});
