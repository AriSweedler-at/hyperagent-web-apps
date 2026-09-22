// No jsdom here (docs/ARCHITECTURE.md "Testing pyramid"): the home screen runs against the page
// fake built from the page's own markup (ui/page.fake.ts over web/games/gin-rummy/index.html).
import { describe, expect, test } from 'vitest';

import { fakeTarget } from '../../../../shared/edge/page.fake.ts';
import { mulberry32 } from '../../../../shared/lib/rng.ts';
import { createGame } from '../engine/index.ts';
import {
  bindHome,
  blocksCodeInput,
  fillNameInputs,
  fillP2NameInput,
  inviteUrl,
  paintHome,
  renderSandbox,
  setCodeInput,
  tabButtonId,
} from './home.ts';
import { PRESETS } from '../sandbox.ts';
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
  test('fillNameInputs writes the three first-name inputs, fillP2NameInput the two second ones; setCodeInput the code field', () => {
    const p = page();
    expect(p.get('nameInput').value()).toBe('Ari');
    fillNameInputs(p.doc, 'Ann');
    expect(p.get('nameInput').value()).toBe('Ann');
    expect(p.get('p1NameInput').value()).toBe('Ann');
    expect(p.get('scP1NameInput').value()).toBe('Ann');
    expect(p.get('p2NameInput').value()).toBe('');
    fillP2NameInput(p.doc, 'Bob');
    expect(p.get('p2NameInput').value()).toBe('Bob');
    expect(p.get('scP2NameInput').value()).toBe('Bob');
    expect(p.get('p1NameInput').value()).toBe('Ann');
    setCodeInput(p.doc, 'AB');
    expect(p.get('codeInput').value()).toBe('AB');
  });
});

describe('pure helpers', () => {
  test('inviteUrl is the page with the code to join, and nothing else', () => {
    expect(inviteUrl('KQZM', 'https://games.sweedler.com/gin-rummy/')).toBe(
      'https://games.sweedler.com/gin-rummy/?join=KQZM',
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
    expect(p.modeButtons.map((b) => b.hasClass('active'))).toEqual([true, false, false]);
    expect(p.submenuButtons.map((b) => b.hasClass('active'))).toEqual([true, false, false]);
    expect(p.get('playSubmenu').hasClass('force-open')).toBe(false);
    expect(p.get('resumeBox').hidden()).toBe(true);
    expect(p.get('handoffBtn').hidden()).toBe(true);

    paintHome(p.doc, {
      ...initialApp,
      playMode: 'local',
      submenuOpen: true,
      resume: { kind: 'guest', code: 'KQZM', myName: 'Jo' },
    });
    expect(p.get('onlineModeContent').hidden()).toBe(true);
    expect(p.get('localModeContent').hidden()).toBe(false);
    expect(p.modeButtons.map((b) => b.hasClass('active'))).toEqual([false, true, false]);
    expect(p.submenuButtons.map((b) => b.hasClass('active'))).toEqual([false, true, false]);
    expect(p.get('playSubmenu').hasClass('force-open')).toBe(true);
    expect(p.get('resumeBox').hidden()).toBe(false);
    expect(p.get('resumeBtn').text()).toBe('Rejoin room KQZM');
    expect(p.get('handoffBtn').hidden()).toBe(true);

    // Only a pass-and-play game is offered online.
    const game = createGame(
      {
        players: [
          { id: 'p1', name: 'Ann' },
          { id: 'p2', name: 'Bob' },
        ],
        target: 100,
      },
      mulberry32(1),
      () => 1,
    );
    paintHome(p.doc, { ...initialApp, resume: { kind: 'local', game } });
    expect(p.get('resumeBtn').text()).toBe('Resume pass & play: Ann vs Bob');
    expect(p.get('handoffBtn').hidden()).toBe(false);
    expect(p.get('handoffBtn').text()).toBe('Continue online: Ann hosts, Bob joins by invite');
  });

  test('renderPlayMode ran only on the Play tab: another tab leaves the mode marks as they were', () => {
    const p = page();
    paintHome(p.doc, { ...initialApp, homeTab: 'rules', playMode: 'local' });
    expect(p.get('tabRulesBtn').hasClass('active')).toBe(true);
    expect(p.get('rulesPanel').hidden()).toBe(false);
    expect(p.get('playPanel').hidden()).toBe(true);
    expect(p.get('localModeContent').hidden()).toBe(true);
    expect(p.modeButtons.map((b) => b.hasClass('active'))).toEqual([false, false, false]);
    expect(p.submenuButtons.map((b) => b.hasClass('active'))).toEqual([false, false, false]);
    paintHome(p.doc, { ...initialApp, homeTab: 'score' });
    expect(p.get('scorePanel').hidden()).toBe(false);
  });

  test('the sandbox: its mode buttons show for the first name "sandbox"; its panel, map and error paint from the App', () => {
    const p = page();
    paintHome(p.doc, initialApp);
    expect(p.modeButtons[2]?.hidden()).toBe(true);
    expect(p.submenuButtons[2]?.hidden()).toBe(true);
    expect(p.get('sandboxModeContent').hidden()).toBe(true);
    expect(p.get('sbMap').value()).toBe(initialApp.sandbox.map);
    expect(p.get('sbPreset').value()).toBe('no-melds');
    expect(p.get('sbError').text()).toBe('');
    paintHome(p.doc, {
      ...initialApp,
      p1Name: 'Sandbox',
      playMode: 'sandbox',
      sandbox: { preset: '', map: 'p1: AS', error: 'p1 needs 10 cards, has 1', helpOpen: false },
    });
    expect(p.modeButtons[2]?.hidden()).toBe(false);
    expect(p.submenuButtons[2]?.hidden()).toBe(false);
    expect(p.modeButtons.map((b) => b.hasClass('active'))).toEqual([false, false, true]);
    expect(p.get('sandboxModeContent').hidden()).toBe(false);
    expect(p.get('onlineModeContent').hidden()).toBe(true);
    expect(p.get('sbMap').value()).toBe('p1: AS');
    expect(p.get('sbError').text()).toBe('p1 needs 10 cards, has 1');
  });

  test('renderSandbox lists every preset by title, then a random deal', () => {
    const p = page();
    renderSandbox(p.doc);
    const html = p.get('sbPreset').text();
    PRESETS.forEach((preset) => {
      expect(html).toContain(`<option value="${preset.id}">`);
    });
    expect(html).toContain('<option value="random">');
    expect(html.match(/<option /g)).toHaveLength(PRESETS.length + 1);
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
    type(p, 'scP1NameInput', 'Cy');
    p.get('scP1NameInput').fire('input');
    type(p, 'scP2NameInput', 'Di');
    p.get('scP2NameInput').fire('input');
    type(p, 'localTargetInput', '50');
    p.get('localBtn').fire('click');
    p.get('tabRulesBtn').fire('click');
    p.get('tabScoreBtn').fire('click');
    p.modeButtons[1]?.fire('click');
    p.modeButtons[2]?.fire('click');
    p.get('resumeBtn').fire('click');
    p.get('handoffBtn').fire('click');
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
      { type: 'p1name/typed', value: 'Cy' },
      { type: 'p2name/typed', value: 'Di' },
      { type: 'local/click', p1: 'Zoë', p2: 'Bob', target: '50' },
      { type: 'tab/set', tab: 'rules' },
      { type: 'tab/set', tab: 'score' },
      { type: 'mode/set', mode: 'local' },
      { type: 'mode/set', mode: 'sandbox' },
      { type: 'resume/click' },
      { type: 'handoff/click' },
      { type: 'share/click' },
      { type: 'cancel' },
      { type: 'cancel' },
    ]);
  });

  test('the sandbox controls: preset, random, typing, the buttons, and the deal with the pass-and-play names', () => {
    const { p, intents } = wired();
    p.get('sbPreset').fire('change', { target: fakeTarget({ value: 'gin-in-hand' }) });
    p.get('sbPreset').fire('change', { target: fakeTarget({ value: 'random' }) });
    type(p, 'sbMap', 'p1: AS');
    p.get('sbMap').fire('input');
    p.get('sbRandomBtn').fire('click');
    p.get('sbCopyBtn').fire('click');
    p.get('sbHelpBtn').fire('click');
    type(p, 'p1NameInput', 'sandbox');
    type(p, 'p2NameInput', 'Bob');
    p.get('sbStartBtn').fire('click');
    expect(intents).toEqual([
      { type: 'sandbox/preset', id: 'gin-in-hand' },
      { type: 'sandbox/random' },
      { type: 'sandbox/typed', value: 'p1: AS' },
      { type: 'sandbox/random' },
      { type: 'sandbox/copy' },
      { type: 'sandbox/help', open: true },
      { type: 'sandbox/start', map: 'p1: AS', p1: 'sandbox', p2: 'Bob' },
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
