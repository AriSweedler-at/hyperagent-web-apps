// The shared shell painters over a FAKE page (web/shared/edge/page.fake.ts) that carries only the
// ids they touch: what each writes, class by class, and that the App-free views paint what both
// games' render.test.ts suites pin through their wrappers.
import { describe, expect, test } from 'vitest';

import { fakeEl, fakePage, fakeTarget, type FakePage } from '../edge/page.fake.ts';
import {
  bindSheets,
  ensureKeyed,
  hideToast,
  paintHandoff,
  paintScreen,
  paintSheet,
  paintSound,
  paintWaiting,
  showToast,
  type Sheet,
} from './shellPaint.ts';

const SCREENS = ['homeScreen', 'hostWaitScreen', 'tableScreen'] as const;

const page = (): FakePage =>
  fakePage([
    fakeEl('homeScreen'),
    fakeEl('hostWaitScreen', { classes: ['hidden'] }),
    fakeEl('tableScreen', { classes: ['hidden'] }),
    fakeEl('roomCode', { text: '----' }),
    fakeEl('hostWaitStatus', { classes: ['pulse'], text: 'Opening room…' }),
    fakeEl('startGameBtn', { classes: ['btn', 'hidden'] }),
    fakeEl('guestWaitStatus', { classes: ['pulse'] }),
    fakeEl('toast'),
    fakeEl('soundBtn', { text: '🔊', attrs: { title: 'Sound & vibration' } }),
    fakeEl('handoffBtn', { classes: ['icon-btn', 'hidden'], attrs: { title: 'Continue online' } }),
    fakeEl('rulesOverlay', { classes: ['overlay', 'hidden'] }),
    fakeEl('closeRulesBtn'),
    fakeEl('menuOverlay', { classes: ['overlay', 'hidden'] }),
    fakeEl('closeMenuBtn'),
  ]);

const shown = (p: FakePage): ReadonlyArray<string> => SCREENS.filter((id) => !p.get(id).hidden());

type Intent = Readonly<{ type: string }>;
const SHEETS: ReadonlyArray<Sheet<Intent>> = [
  { overlay: 'rulesOverlay', close: 'closeRulesBtn', intent: { type: 'rules/close' } },
  { overlay: 'menuOverlay', close: 'closeMenuBtn', intent: { type: 'menu/toggle' } },
];

const wired = (
  opts?: Readonly<{ escapeFallback: Intent }>,
): Readonly<{ p: FakePage; intents: ReadonlyArray<Intent> }> => {
  const p = page();
  const intents: Intent[] = [];
  bindSheets(
    p.doc,
    SHEETS,
    (i) => {
      intents.push(i);
    },
    opts,
  );
  return { p, intents };
};

describe('paintScreen', () => {
  test('shows exactly the current screen and locks the body at the fixed one', () => {
    const p = page();
    paintScreen(p.doc, SCREENS, 'tableScreen', 'tableScreen');
    expect(shown(p)).toEqual(['tableScreen']);
    expect(p.body.hasClass('fixed-screen')).toBe(true);
    paintScreen(p.doc, SCREENS, 'hostWaitScreen', 'tableScreen');
    expect(shown(p)).toEqual(['hostWaitScreen']);
    expect(p.body.hasClass('fixed-screen')).toBe(false);
  });
});

describe('paintWaiting', () => {
  test('the code (dashes for none), both statuses with their pulse, the start button', () => {
    const p = page();
    paintWaiting(p.doc, {
      code: null,
      hostStatus: { text: 'Opening room…', pulse: true },
      guestStatus: { text: 'Connecting…', pulse: true },
      startGameVisible: false,
    });
    expect(p.get('roomCode').text()).toBe('----');
    expect(p.get('hostWaitStatus').text()).toBe('Opening room…');
    expect(p.get('hostWaitStatus').hasClass('pulse')).toBe(true);
    expect(p.get('guestWaitStatus').text()).toBe('Connecting…');
    expect(p.get('startGameBtn').hidden()).toBe(true);
    paintWaiting(p.doc, {
      code: 'ABCD',
      hostStatus: { text: 'Jeff joined! Ready when you are.', pulse: false },
      guestStatus: { text: 'Connected', pulse: false },
      startGameVisible: true,
    });
    expect(p.get('roomCode').text()).toBe('ABCD');
    expect(p.get('hostWaitStatus').text()).toBe('Jeff joined! Ready when you are.');
    expect(p.get('hostWaitStatus').hasClass('pulse')).toBe(false);
    expect(p.get('guestWaitStatus').text()).toBe('Connected');
    expect(p.get('guestWaitStatus').hasClass('pulse')).toBe(false);
    expect(p.get('startGameBtn').hidden()).toBe(false);
    expect(p.get('startGameBtn').hasClass('btn')).toBe(true);
  });
});

describe('showToast / hideToast', () => {
  test('write the text and flip the show class; the text stays when hidden', () => {
    const p = page();
    showToast(p.doc, 'Connected directly');
    expect(p.get('toast').text()).toBe('Connected directly');
    expect(p.get('toast').hasClass('show')).toBe(true);
    hideToast(p.doc);
    expect(p.get('toast').hasClass('show')).toBe(false);
    expect(p.get('toast').text()).toBe('Connected directly');
  });

  test('marks go on for the message that earns them and off for the next one', () => {
    const p = page();
    showToast(p.doc, 'Kapará. Bob hit you on your 5-point.', { hit: true });
    expect(p.get('toast').classes()).toEqual(['hit', 'show']);
    showToast(p.doc, 'Invite copied to clipboard', { hit: false });
    expect(p.get('toast').classes()).toEqual(['show']);
    showToast(p.doc, 'plain', { hit: false, warm: true });
    expect(p.get('toast').classes()).toEqual(['show', 'warm']);
  });
});

describe('paintSound', () => {
  test('the glyph and the tooltip', () => {
    const p = page();
    paintSound(p.doc, false);
    expect(p.get('soundBtn').text()).toBe('🔇');
    expect(p.get('soundBtn').attr('title')).toBe('Sound & vibration off');
    paintSound(p.doc, true);
    expect(p.get('soundBtn').text()).toBe('🔊');
    expect(p.get('soundBtn').attr('title')).toBe('Sound & vibration on');
  });
});

describe('paintHandoff', () => {
  test('shows the 🌐 with its tooltip for a label; hides it, tooltip untouched, for none', () => {
    const p = page();
    paintHandoff(p.doc, 'Continue online: Ari hosts, Jeff joins by invite');
    expect(p.get('handoffBtn').hidden()).toBe(false);
    expect(p.get('handoffBtn').attr('title')).toBe(
      'Continue online: Ari hosts, Jeff joins by invite',
    );
    paintHandoff(p.doc, null);
    expect(p.get('handoffBtn').hidden()).toBe(true);
    expect(p.get('handoffBtn').attr('title')).toBe(
      'Continue online: Ari hosts, Jeff joins by invite',
    );
  });
});

describe('paintSheet / bindSheets', () => {
  test('paintSheet follows the flag', () => {
    const p = page();
    paintSheet(p.doc, 'rulesOverlay', true);
    expect(p.get('rulesOverlay').hidden()).toBe(false);
    paintSheet(p.doc, 'rulesOverlay', false);
    expect(p.get('rulesOverlay').hidden()).toBe(true);
  });

  test('the close button and the backdrop dispatch the sheet intent; a child of the overlay does not', () => {
    const { p, intents } = wired();
    p.get('closeRulesBtn').fire('click');
    expect(intents).toEqual([{ type: 'rules/close' }]);
    p.get('rulesOverlay').fire('click');
    expect(intents).toEqual([{ type: 'rules/close' }, { type: 'rules/close' }]);
    p.get('rulesOverlay').fire('click', { target: fakeTarget({ id: 'rulesList' }) });
    expect(intents).toHaveLength(2);
    p.get('closeMenuBtn').fire('click');
    expect(intents.at(-1)).toEqual({ type: 'menu/toggle' });
  });

  test('without a fallback no key is listened to; with one, Escape closes the open sheet or dispatches the fallback', () => {
    const plain = wired();
    plain.p.fire('keydown', { key: 'Escape' });
    expect(plain.intents).toEqual([]);
    const { p, intents } = wired({ escapeFallback: { type: 'chip/cancel' } });
    p.fire('keydown', { key: 'Escape' });
    expect(intents).toEqual([{ type: 'chip/cancel' }]);
    p.get('menuOverlay').el.classList.remove('hidden');
    p.fire('keydown', { key: 'Escape' });
    expect(intents.at(-1)).toEqual({ type: 'menu/toggle' });
    p.fire('keydown', { key: 'x' });
    expect(intents).toHaveLength(2);
  });
});

describe('ensureKeyed', () => {
  test('rebuilds the element only when the key changes, and records the key', () => {
    const el = fakeEl('dice', { text: 'old' });
    const builds: string[] = [];
    const markup = (): string => {
      builds.push('built');
      return '<b>new</b>';
    };
    ensureKeyed(el.el, 'k1', markup);
    expect(el.attr('data-key')).toBe('k1');
    expect(el.text()).toBe('<b>new</b>');
    ensureKeyed(el.el, 'k1', markup);
    expect(builds).toHaveLength(1);
    ensureKeyed(el.el, 'k2', markup);
    expect(builds).toHaveLength(2);
    expect(el.attr('data-key')).toBe('k2');
  });
});
