// The home shell over a fake page (docs/design/shared-shell.md §4.1: "over a FAKE_GAME and
// dom.fake/page.fake"): the shell ids both pages carry, a three-tab, two-mode game with one start
// option. Each game's ui/home.test.ts still runs the same paint and wiring against its own markup
// through its wrapper; this suite is what holds the shared row at 100 (tools/ci/suites.ts).
import { describe, expect, test } from 'vitest';

import { fakeEl, fakePage, fakeTarget, type FakeEl, type FakePage } from '../edge/page.fake.ts';
import {
  bindHomeShell,
  bindLongPress,
  blocksCodeInput,
  fillInputs,
  paintHomeShell,
  paintPlayMode,
  paintResume,
  paintSubmenu,
  paintTabs,
  setCodeInput,
  tabButtonId,
  type HomeView,
  type ShellIntentBuilders,
} from './home.ts';

const TABS = ['play', 'rules', 'about'] as const;
type Tab = (typeof TABS)[number];
const MODES = ['online', 'local'] as const;
const SHAPE = { tabs: TABS, modes: MODES } as const;

/** A recorded intent: its type and the raw values it carried, in order. */
type Intent = Readonly<{ type: string; args: ReadonlyArray<string> }>;
const intent = (type: string, ...args: ReadonlyArray<string>): Intent => ({ type, args });
type Start = Readonly<{ opt: string }>;

const INTENTS: ShellIntentBuilders<Intent, Tab, Start> = {
  nameTyped: (value) => intent('name/typed', value),
  p1NameTyped: (value) => intent('p1name/typed', value),
  p2NameTyped: (value) => intent('p2name/typed', value),
  hostClick: (name, o) => intent('host/click', name, o.opt),
  joinClick: (name, code) => intent('join/click', name, code),
  codeTyped: (value, inputType) => intent('code/typed', value, inputType),
  hostDeal: intent('host/deal'),
  localClick: (p1, p2, o) => intent('local/click', p1, p2, o.opt),
  tabSet: (tab) => intent('tab/set', tab),
  modeSet: (mode) => intent('mode/set', mode),
  submenuPress: intent('submenu/press'),
  submenuRelease: intent('submenu/release'),
  tabPlayClick: intent('tab/playClick'),
  submenuPick: (mode) => intent('submenu/pick', mode),
  submenuDismiss: intent('submenu/dismiss'),
  resumeClick: intent('resume/click'),
  shareClick: intent('share/click'),
  cancel: intent('cancel'),
};

type ShellPage = FakePage &
  Readonly<{ modeButtons: ReadonlyArray<FakeEl>; submenuButtons: ReadonlyArray<FakeEl> }>;

/**
 * The shell's ids as the markup ships them: the Play tab active, its panel shown, Online active.
 * The third mode button of each set carries no `data-mode` (a page never ships one; it pins what
 * the binder dispatches for the missing attribute).
 */
const shellPage = (): ShellPage => {
  const modeButtons = [
    ...MODES.map((mode) =>
      fakeEl(`modeSwitch-${mode}`, {
        classes: ['mode-btn', ...(mode === 'online' ? ['active'] : [])],
        attrs: { 'data-mode': mode },
      }),
    ),
    fakeEl('modeSwitch-blank', { classes: ['mode-btn'] }),
  ];
  const submenuButtons = [
    ...MODES.map((mode) => fakeEl(`submenu-${mode}`, { attrs: { 'data-mode': mode } })),
    fakeEl('submenu-blank'),
  ];
  const tabPlayBtn = fakeEl('tabPlayBtn', { classes: ['active'] });
  const page = fakePage([
    fakeEl('nameInput', { value: 'Ari' }),
    fakeEl('p1NameInput', { value: 'Ari' }),
    fakeEl('p2NameInput'),
    fakeEl('optInput', { value: '100' }),
    fakeEl('localOptInput', { value: '50' }),
    fakeEl('codeInput'),
    fakeEl('hostBtn'),
    fakeEl('joinBtn'),
    fakeEl('startGameBtn'),
    fakeEl('localBtn'),
    tabPlayBtn,
    fakeEl('tabRulesBtn'),
    fakeEl('tabAboutBtn'),
    fakeEl('tabPlayWrap', { children: [tabPlayBtn] }),
    fakeEl('playPanel'),
    fakeEl('rulesPanel', { classes: ['hidden'] }),
    fakeEl('aboutPanel', { classes: ['hidden'] }),
    fakeEl('onlineModeContent'),
    fakeEl('localModeContent', { classes: ['hidden'] }),
    fakeEl('playModeSwitch', { queries: { '.mode-btn': modeButtons } }),
    fakeEl('playSubmenu', {
      queries: { button: submenuButtons, 'button[data-mode]': submenuButtons },
    }),
    fakeEl('resumeBox', { classes: ['hidden'] }),
    fakeEl('resumeBtn'),
    fakeEl('shareCodeBtn'),
    fakeEl('cancelHostBtn'),
    fakeEl('cancelGuestBtn'),
    ...modeButtons,
    ...submenuButtons,
  ]);
  return { ...page, modeButtons, submenuButtons };
};

/** Type into an input as the player would (the fake's inputs carry a writable value). */
const type = (p: FakePage, id: string, value: string): void => {
  const input = p.get(id).el as HTMLInputElement;
  input.value = value;
};

const view = (over: Partial<HomeView<Tab>> = {}): HomeView<Tab> => ({
  homeTab: 'play',
  playMode: 'online',
  submenuOpen: false,
  resumeLabel: null,
  ...over,
});

describe('the input writes the reducer raises as effects', () => {
  test('fillInputs writes the named inputs and no other; setCodeInput the code field', () => {
    const p = shellPage();
    fillInputs(p.doc, ['nameInput', 'p1NameInput'], 'Ann');
    expect(p.get('nameInput').value()).toBe('Ann');
    expect(p.get('p1NameInput').value()).toBe('Ann');
    expect(p.get('p2NameInput').value()).toBe('');
    fillInputs(p.doc, ['p2NameInput'], 'Bob');
    expect(p.get('p2NameInput').value()).toBe('Bob');
    expect(p.get('p1NameInput').value()).toBe('Ann');
    setCodeInput(p.doc, 'AB');
    expect(p.get('codeInput').value()).toBe('AB');
  });
});

describe('pure helpers', () => {
  test('tabButtonId capitalises the tab', () => {
    expect(['play', 'rules', 'score', 'about'].map(tabButtonId)).toEqual([
      'tabPlayBtn',
      'tabRulesBtn',
      'tabScoreBtn',
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

describe('the painters', () => {
  test('paintTabs marks the current tab and shows its panel alone', () => {
    const p = shellPage();
    paintTabs(p.doc, TABS, 'rules');
    expect(TABS.map((t) => p.get(tabButtonId(t)).hasClass('active'))).toEqual([false, true, false]);
    expect(TABS.map((t) => p.get(`${t}Panel`).hidden())).toEqual([true, false, true]);
  });

  test('paintPlayMode shows the mode panel and marks both sets of mode buttons', () => {
    const p = shellPage();
    paintPlayMode(p.doc, MODES, 'local');
    expect(p.get('onlineModeContent').hidden()).toBe(true);
    expect(p.get('localModeContent').hidden()).toBe(false);
    expect(p.modeButtons.map((b) => b.hasClass('active'))).toEqual([false, true, false]);
    expect(p.submenuButtons.map((b) => b.hasClass('active'))).toEqual([false, true, false]);
  });

  test('paintSubmenu toggles force-open; paintResume hides the box or labels the button', () => {
    const p = shellPage();
    paintSubmenu(p.doc, true);
    expect(p.get('playSubmenu').hasClass('force-open')).toBe(true);
    paintSubmenu(p.doc, false);
    expect(p.get('playSubmenu').hasClass('force-open')).toBe(false);
    paintResume(p.doc, 'Rejoin room KQZM');
    expect(p.get('resumeBox').hidden()).toBe(false);
    expect(p.get('resumeBtn').text()).toBe('Rejoin room KQZM');
    paintResume(p.doc, null);
    expect(p.get('resumeBox').hidden()).toBe(true);
    // The label is left as it was while hidden.
    expect(p.get('resumeBtn').text()).toBe('Rejoin room KQZM');
  });

  test('paintHomeShell: tabs, play mode, submenu and the resume box from the view', () => {
    const p = shellPage();
    paintHomeShell(p.doc, view(), SHAPE);
    expect(p.get('tabPlayBtn').hasClass('active')).toBe(true);
    expect(p.get('playPanel').hidden()).toBe(false);
    expect(p.get('rulesPanel').hidden()).toBe(true);
    expect(p.get('onlineModeContent').hidden()).toBe(false);
    expect(p.get('localModeContent').hidden()).toBe(true);
    expect(p.modeButtons.map((b) => b.hasClass('active'))).toEqual([true, false, false]);
    expect(p.get('playSubmenu').hasClass('force-open')).toBe(false);
    expect(p.get('resumeBox').hidden()).toBe(true);

    paintHomeShell(
      p.doc,
      view({ playMode: 'local', submenuOpen: true, resumeLabel: 'Rejoin room KQZM' }),
      SHAPE,
    );
    expect(p.get('onlineModeContent').hidden()).toBe(true);
    expect(p.get('localModeContent').hidden()).toBe(false);
    expect(p.modeButtons.map((b) => b.hasClass('active'))).toEqual([false, true, false]);
    expect(p.submenuButtons.map((b) => b.hasClass('active'))).toEqual([false, true, false]);
    expect(p.get('playSubmenu').hasClass('force-open')).toBe(true);
    expect(p.get('resumeBox').hidden()).toBe(false);
    expect(p.get('resumeBtn').text()).toBe('Rejoin room KQZM');
  });

  test('renderPlayMode ran only on the Play tab: another tab leaves the mode marks as they were', () => {
    const p = shellPage();
    paintHomeShell(p.doc, view({ homeTab: 'rules', playMode: 'local' }), SHAPE);
    expect(p.get('tabRulesBtn').hasClass('active')).toBe(true);
    expect(p.get('rulesPanel').hidden()).toBe(false);
    expect(p.get('playPanel').hidden()).toBe(true);
    // The markup's marks (Online active, the local panel hidden) stand until the Play tab paints.
    expect(p.get('localModeContent').hidden()).toBe(true);
    expect(p.modeButtons.map((b) => b.hasClass('active'))).toEqual([true, false, false]);
    paintHomeShell(p.doc, view({ homeTab: 'about' }), SHAPE);
    expect(p.get('aboutPanel').hidden()).toBe(false);
  });
});

describe('bindLongPress', () => {
  test('press on pointerdown; release on pointerup, pointerleave and pointercancel', () => {
    const el = fakeEl('btn');
    const intents: Intent[] = [];
    bindLongPress(
      el.el,
      (i: Intent) => {
        intents.push(i);
      },
      { press: intent('press'), release: intent('release') },
    );
    el.fire('pointerdown');
    el.fire('pointerup');
    el.fire('pointerleave');
    el.fire('pointercancel');
    el.fire('click');
    expect(intents.map((i) => i.type)).toEqual(['press', 'release', 'release', 'release']);
  });
});

describe('bindHomeShell', () => {
  const wired = (): Readonly<{ p: ShellPage; intents: Intent[] }> => {
    const p = shellPage();
    const intents: Intent[] = [];
    bindHomeShell(
      p.doc,
      (i) => {
        intents.push(i);
      },
      {
        tabs: TABS,
        startOptions: {
          host: (doc) => ({ opt: (doc.getElementById('optInput') as HTMLInputElement).value }),
          local: (doc) => ({
            opt: (doc.getElementById('localOptInput') as HTMLInputElement).value,
          }),
        },
        intents: INTENTS,
      },
    );
    return { p, intents };
  };

  test('the inputs and buttons dispatch with the raw values, the start options read at the click', () => {
    const { p, intents } = wired();
    type(p, 'nameInput', ' Ann ');
    p.get('nameInput').fire('input');
    type(p, 'p1NameInput', 'Zoë');
    p.get('p1NameInput').fire('input');
    type(p, 'p2NameInput', 'Bob');
    p.get('p2NameInput').fire('input');
    type(p, 'optInput', '75');
    p.get('hostBtn').fire('click');
    type(p, 'codeInput', 'abcd');
    p.get('joinBtn').fire('click');
    p.get('codeInput').fire('keydown', { key: 'Enter' });
    p.get('codeInput').fire('keydown', { key: 'a' });
    p.get('startGameBtn').fire('click');
    type(p, 'localOptInput', '25');
    p.get('localBtn').fire('click');
    p.get('tabRulesBtn').fire('click');
    p.get('tabAboutBtn').fire('click');
    p.modeButtons.forEach((b) => {
      b.fire('click');
    });
    p.get('resumeBtn').fire('click');
    p.get('shareCodeBtn').fire('click');
    p.get('cancelHostBtn').fire('click');
    p.get('cancelGuestBtn').fire('click');
    expect(intents).toEqual([
      intent('name/typed', ' Ann '),
      intent('p1name/typed', 'Zoë'),
      intent('p2name/typed', 'Bob'),
      intent('host/click', ' Ann ', '75'),
      intent('join/click', ' Ann ', 'abcd'),
      intent('join/click', ' Ann ', 'abcd'),
      intent('host/deal'),
      intent('local/click', 'Zoë', 'Bob', '25'),
      intent('tab/set', 'rules'),
      intent('tab/set', 'about'),
      intent('mode/set', 'online'),
      intent('mode/set', 'local'),
      intent('mode/set', ''),
      intent('resume/click'),
      intent('share/click'),
      intent('cancel'),
      intent('cancel'),
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
    expect(intents).toEqual([intent('code/typed', 'ab', 'insertText')]);
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
    p.submenuButtons[2]?.fire('click');
    // The document-level click: inside the Play tab's wrap it is ignored, outside it dismisses.
    p.fire('click', { target: p.get('tabPlayBtn').el });
    p.fire('click', { target: p.get('tabPlayWrap').el });
    p.fire('click', { target: p.get('nameInput').el });
    p.fire('click');
    expect(intents).toEqual([
      intent('submenu/press'),
      intent('submenu/release'),
      intent('submenu/release'),
      intent('submenu/release'),
      intent('tab/playClick'),
      intent('submenu/pick', 'local'),
      intent('submenu/pick', ''),
      intent('submenu/dismiss'),
      intent('submenu/dismiss'),
    ]);
  });
});
