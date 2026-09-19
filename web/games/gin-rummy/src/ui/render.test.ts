// No jsdom here (docs/ARCHITECTURE.md "Testing pyramid"): the paint runs against a structural
// fake of the members dom.ts touches, one element per id the page holds.
import { describe, expect, test } from 'vitest';

import { RULES_ITEMS, RULES_LIST_HTML } from './rules.ts';
import {
  RULES_SLOT_IDS,
  hideToast,
  paint,
  paintScreen,
  paintWaiting,
  renderRules,
  rulesItemsHtml,
  showToast,
  type PageLike,
} from './render.ts';
import { SCREENS, initialApp, type App } from './state.ts';

type FakeEl = Readonly<{
  el: HTMLElement;
  classes: Set<string>;
  text: () => string;
  html: () => string;
}>;

const fakeElement = (initialClasses: ReadonlyArray<string> = []): FakeEl => {
  const classes = new Set<string>(initialClasses);
  const children: string[] = [];
  const el = {
    replaceChildren: (...nodes: string[]) => {
      children.splice(0, children.length, ...nodes);
    },
    insertAdjacentHTML: (_position: string, markup: string) => {
      children.unshift(`html:${markup}`);
    },
    classList: {
      toggle: (name: string, force?: boolean) => {
        const on = force ?? !classes.has(name);
        if (on) classes.add(name);
        else classes.delete(name);
        return on;
      },
      contains: (name: string) => classes.has(name),
    },
  };
  return {
    el: el as unknown as HTMLElement,
    classes,
    text: () => children.join(''),
    html: () => children.map((c) => c.replace(/^html:/, '')).join(''),
  };
};

type FakePage = Readonly<{ doc: PageLike; els: Readonly<Record<string, FakeEl>>; body: FakeEl }>;

/** The page's screens and waiting elements, hidden as the markup has them (all but the home). */
const fakePage = (): FakePage => {
  const ids = [
    ...SCREENS,
    'roomCode',
    'hostWaitStatus',
    'startGameBtn',
    'guestWaitStatus',
    'toast',
    ...RULES_SLOT_IDS,
  ];
  const els = Object.fromEntries(
    ids.map((id) => [
      id,
      fakeElement(
        SCREENS.includes(id as (typeof SCREENS)[number]) && id !== 'homeScreen'
          ? ['hidden']
          : id === 'hostWaitStatus' || id === 'guestWaitStatus'
            ? ['pulse']
            : id === 'startGameBtn'
              ? ['btn', 'hidden']
              : [],
      ),
    ]),
  );
  const body = fakeElement();
  return {
    doc: { getElementById: (id) => els[id]?.el ?? null, body: body.el },
    els,
    body,
  };
};

const shown = (page: FakePage): ReadonlyArray<string> =>
  SCREENS.filter((id) => !page.els[id]?.classes.has('hidden'));

describe('renderRules', () => {
  test('fills both slots with the eleven items, one per line, as ui/rules.ts has them', () => {
    const page = fakePage();
    renderRules(page.doc);
    RULES_SLOT_IDS.forEach((id) => {
      expect(page.els[id]?.html()).toBe(rulesItemsHtml());
    });
    expect(rulesItemsHtml().split('\n')).toHaveLength(RULES_ITEMS.length);
    expect(`<ul class="rules-list">\n${rulesItemsHtml()}\n</ul>`).toBe(RULES_LIST_HTML);
    expect(RULES_SLOT_IDS).toEqual(['rulesList', 'rulesOverlayList']);
  });
});

describe('paintScreen', () => {
  test('shows exactly the app screen and locks the body for the table', () => {
    const page = fakePage();
    paintScreen(page.doc, initialApp);
    expect(shown(page)).toEqual(['homeScreen']);
    expect(page.body.classes.has('fixed-screen')).toBe(false);
    paintScreen(page.doc, { ...initialApp, screen: 'tableScreen' });
    expect(shown(page)).toEqual(['tableScreen']);
    expect(page.body.classes.has('fixed-screen')).toBe(true);
    paintScreen(page.doc, { ...initialApp, screen: 'scEndScreen' });
    expect(shown(page)).toEqual(['scEndScreen']);
    expect(page.body.classes.has('fixed-screen')).toBe(false);
  });
});

describe('paintWaiting', () => {
  test('the room code, both statuses with their pulse, and the deal button', () => {
    const page = fakePage();
    paintWaiting(page.doc, initialApp);
    expect(page.els['roomCode']?.text()).toBe('----');
    expect(page.els['hostWaitStatus']?.text()).toBe('Opening room…');
    expect(page.els['hostWaitStatus']?.classes.has('pulse')).toBe(true);
    expect(page.els['guestWaitStatus']?.text()).toBe('Connecting…');
    expect(page.els['startGameBtn']?.classes.has('hidden')).toBe(true);
    const waiting: App = {
      ...initialApp,
      code: 'ABCD',
      hostStatus: { text: 'Jeff joined! Ready when you are.', pulse: true },
      guestStatus: { text: 'boom', pulse: false },
      startGameVisible: true,
    };
    paintWaiting(page.doc, waiting);
    expect(page.els['roomCode']?.text()).toBe('ABCD');
    expect(page.els['hostWaitStatus']?.text()).toBe('Jeff joined! Ready when you are.');
    expect(page.els['guestWaitStatus']?.text()).toBe('boom');
    expect(page.els['guestWaitStatus']?.classes.has('pulse')).toBe(false);
    expect(page.els['startGameBtn']?.classes.has('hidden')).toBe(false);
    expect(page.els['startGameBtn']?.classes.has('btn')).toBe(true);
  });
});

describe('paint', () => {
  test('is the screen and the waiting elements together, and idempotent', () => {
    const page = fakePage();
    const app: App = { ...initialApp, screen: 'hostWaitScreen', code: 'WXYZ' };
    paint(page.doc, app);
    paint(page.doc, app);
    expect(shown(page)).toEqual(['hostWaitScreen']);
    expect(page.els['roomCode']?.text()).toBe('WXYZ');
  });

  test('a missing element is a programming error', () => {
    const page = fakePage();
    const doc: PageLike = { getElementById: () => null, body: page.body.el };
    expect(() => {
      paint(doc, initialApp);
    }).toThrow('missing element #homeScreen');
  });
});

describe('showToast / hideToast', () => {
  test('write the text and flip the show class; the timer stays in main.ts', () => {
    const page = fakePage();
    showToast(page.doc, 'Connected directly');
    expect(page.els['toast']?.text()).toBe('Connected directly');
    expect(page.els['toast']?.classes.has('show')).toBe(true);
    showToast(page.doc, 'Room code: ABCD');
    expect(page.els['toast']?.text()).toBe('Room code: ABCD');
    hideToast(page.doc);
    expect(page.els['toast']?.classes.has('show')).toBe(false);
    expect(page.els['toast']?.text()).toBe('Room code: ABCD');
  });
});
