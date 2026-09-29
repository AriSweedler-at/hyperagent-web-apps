// The shared shell painters over a FAKE page (web/shared/edge/page.fake.ts) that carries only the
// ids they touch: what each writes, class by class, and that the App-free views paint what both
// games' render.test.ts suites pin through their wrappers.
import { describe, expect, test } from 'vitest';

import { closestFrom, dataOf } from '../edge/dom.ts';
import { fakeEl, fakePage, fakeTarget, type FakeEl, type FakePage } from '../edge/page.fake.ts';
import {
  bindButtons,
  bindLongPress,
  bindSheets,
  connDotClass,
  connDotView,
  hideToast,
  hostSeesMsg,
  paintConnDot,
  paintFlip,
  paintGate,
  paintHandoff,
  paintScreen,
  paintSheet,
  paintSound,
  paintWaiting,
  seatLabel,
  seatListHtml,
  seatListKey,
  seatRows,
  showToast,
  type Sheet,
} from './shellPaint.ts';

const SCREENS = ['homeScreen', 'hostWaitScreen', 'tableScreen'] as const;

/** The ids every shell page carries that these painters touch; `#seatList` is an N-seat page's alone and a test adds it. */
const pageEls = (): ReadonlyArray<FakeEl> => [
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
  fakeEl('connDot', { classes: ['conn-dot', 'off'], attrs: { title: 'Disconnected' } }),
  fakeEl('rulesOverlay', { classes: ['overlay', 'hidden'] }),
  fakeEl('closeRulesBtn'),
  fakeEl('menuOverlay', { classes: ['overlay', 'hidden'] }),
  fakeEl('closeMenuBtn'),
  fakeEl('stockPile'),
  fakeEl('undoBtn', { attrs: { disabled: '' } }),
  fakeEl('hand'),
];

const page = (): FakePage => fakePage(pageEls());

/** Backgammon's and briscola's page: the shell ids plus the guest wait screen's name card (its Change is the binder's, not the paint's), hidden as shipped. */
const cardPage = (): FakePage =>
  fakePage([
    ...pageEls(),
    fakeEl('guestSeatName', { classes: ['hidden'] }),
    fakeEl('guestNameInput'),
    fakeEl('guestNameNote'),
  ]);

/** Type into an input as the player would (the fake's inputs carry a writable value). */
const typeInto = (p: FakePage, id: string, value: string): void => {
  const input = p.get(id).el as HTMLInputElement;
  input.value = value;
};

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

  test('the name card, when the page has it: shown with the box prefilled and the note naming the host once the host has answered, hidden and emptied for null or none; a page without it paints the rest as before', () => {
    const waiting = {
      code: 'ABCD',
      hostStatus: { text: 'Waiting…', pulse: true },
      guestStatus: { text: 'Connected', pulse: false },
      startGameVisible: false,
      myName: 'Ari',
      oppName: 'Ann',
    };
    // gin's page: no `#guestSeatName`, so the seated name paints nothing and the rest as before.
    const plain = page();
    paintWaiting(plain.doc, { ...waiting, seatedName: 'Ari 2' });
    expect(plain.get('guestWaitStatus').text()).toBe('Connected');
    expect(plain.get('roomCode').text()).toBe('ABCD');
    // backgammon's and briscola's: the card under the status, hidden as shipped.
    const p = cardPage();
    paintWaiting(p.doc, { ...waiting, seatedName: 'Ari 2' });
    expect(p.get('guestSeatName').hidden()).toBe(false);
    expect(p.get('guestNameInput').value()).toBe('Ari 2');
    expect(p.get('guestNameInput').attr('data-seated')).toBe('Ari 2');
    expect(p.get('guestNameNote').text()).toBe(hostSeesMsg('Ann'));
    expect(p.get('guestNameNote').text()).toBe('Ann will see this name.');
    paintWaiting(p.doc, { ...waiting, seatedName: 'Guest' });
    expect(p.get('guestNameInput').value()).toBe('Guest');
    // No seat named (before the welcome, after a cancel): hidden, the box and the note emptied.
    paintWaiting(p.doc, { ...waiting, seatedName: null, oppName: null });
    expect(p.get('guestSeatName').hidden()).toBe(true);
    expect(p.get('guestNameInput').value()).toBe('');
    expect(p.get('guestNameInput').attr('data-seated')).toBeNull();
    expect(p.get('guestNameNote').text()).toBe('');
    paintWaiting(p.doc, { ...waiting, seatedName: 'Bo' });
    expect(p.get('guestSeatName').hidden()).toBe(false);
    expect(p.get('guestNameInput').value()).toBe('Bo');
    expect(p.get('guestNameNote').text()).toBe('Ann will see this name.');
    paintWaiting(p.doc, waiting);
    expect(p.get('guestSeatName').hidden()).toBe(true);
    expect(p.get('guestNameInput').value()).toBe('');
    // A card without its box or note (a page that carries the wrapper alone) paints what it has.
    const bare = fakePage([...pageEls(), fakeEl('guestSeatName', { classes: ['hidden'] })]);
    paintWaiting(bare.doc, { ...waiting, seatedName: 'Bo' });
    expect(bare.get('guestSeatName').hidden()).toBe(false);
  });

  test('the name card never fights typing: a box the player edited is left alone by every paint, and refilled only when the seated name changes while the box holds the previous seated name or the word the player sent', () => {
    // The room as a guest that has sent no word sees it; `waiting` is one that sent 'Guest'.
    const unnamed = {
      code: 'ABCD',
      hostStatus: { text: 'Waiting…', pulse: true },
      guestStatus: { text: 'Connected', pulse: false },
      startGameVisible: false,
      oppName: 'Ann',
    };
    const waiting = { ...unnamed, myName: 'Guest' };
    const p = cardPage();
    paintWaiting(p.doc, { ...waiting, seatedName: 'Guest' });
    expect(p.get('guestNameInput').value()).toBe('Guest');
    // Typing: every repaint with the same seated name (a status, a seat list) touches nothing.
    typeInto(p, 'guestNameInput', 'Xy');
    paintWaiting(p.doc, { ...waiting, seatedName: 'Guest' });
    paintWaiting(p.doc, {
      ...waiting,
      seatedName: 'Guest',
      guestStatus: { text: 'Connected — still', pulse: false },
    });
    expect(p.get('guestNameInput').value()).toBe('Xy');
    // Change tapped with 'ann' in the box: the reducer sent 'ann' (`myName`) and mirrored 'ann 2';
    // the box takes the answer, since what it holds is the word that was sent.
    typeInto(p, 'guestNameInput', 'ann');
    paintWaiting(p.doc, { ...waiting, myName: 'ann', seatedName: 'ann 2' });
    expect(p.get('guestNameInput').value()).toBe('ann 2');
    expect(p.get('guestNameInput').attr('data-seated')).toBe('ann 2');
    // The lobby answering with the same word: nothing to do.
    paintWaiting(p.doc, { ...waiting, myName: 'ann', seatedName: 'ann 2' });
    expect(p.get('guestNameInput').value()).toBe('ann 2');
    // Typed on before an answer arrived: a seated name that is neither the previous one nor the
    // sent word leaves the box alone, and is still recorded as the last seated name.
    typeInto(p, 'guestNameInput', 'ann 2 more');
    paintWaiting(p.doc, { ...waiting, myName: 'ann', seatedName: 'ann 3' });
    expect(p.get('guestNameInput').value()).toBe('ann 2 more');
    expect(p.get('guestNameInput').attr('data-seated')).toBe('ann 3');
    // A box holding the previous seated name follows the next one (nothing was typed since).
    typeInto(p, 'guestNameInput', 'ann 3');
    paintWaiting(p.doc, { ...waiting, myName: 'ann', seatedName: 'ann 4' });
    expect(p.get('guestNameInput').value()).toBe('ann 4');
    // The sent word is compared as the wire normalises it: the spaces around it and a cut at 20.
    typeInto(p, 'guestNameInput', '  Xyz ');
    paintWaiting(p.doc, { ...waiting, myName: 'Xyz', seatedName: 'Xyz' });
    expect(p.get('guestNameInput').value()).toBe('Xyz');
    typeInto(p, 'guestNameInput', `${'x'.repeat(20)}tail`);
    paintWaiting(p.doc, { ...waiting, myName: 'x'.repeat(20), seatedName: `${'x'.repeat(20)} 2` });
    expect(p.get('guestNameInput').value()).toBe(`${'x'.repeat(20)} 2`);
    // Leaving the room (`cancel/finish`: null) empties a box that held the seated name; the next
    // room's welcome fills the empty box.
    paintWaiting(p.doc, { ...waiting, seatedName: null });
    expect(p.get('guestNameInput').value()).toBe('');
    paintWaiting(p.doc, { ...waiting, myName: 'Cy', seatedName: 'Cy' });
    expect(p.get('guestNameInput').value()).toBe('Cy');
    // A guest that has sent no word (`myName` absent: nothing for the box to be matched against)
    // keeps what it typed through a seated-name change, which is still recorded; a box holding the
    // previous seated name follows the next one as for anyone.
    typeInto(p, 'guestNameInput', 'Cy typed');
    paintWaiting(p.doc, { ...unnamed, seatedName: 'Cy 2' });
    expect(p.get('guestNameInput').value()).toBe('Cy typed');
    expect(p.get('guestNameInput').attr('data-seated')).toBe('Cy 2');
    typeInto(p, 'guestNameInput', 'Cy 2');
    paintWaiting(p.doc, { ...unnamed, seatedName: 'Cy 3' });
    expect(p.get('guestNameInput').value()).toBe('Cy 3');
  });

  test('the seat list, when the page has one: the host first, every seat with its state and mine marked, keyed on the rows; nothing while no room is open; a page without it is untouched', () => {
    const waiting = {
      code: 'ABCD',
      hostStatus: { text: 'Waiting…', pulse: true },
      guestStatus: { text: 'Connecting…', pulse: true },
      startGameVisible: false,
    };
    // gin's and backgammon's pages: no `#seatList`, so the shell's seats paint nothing.
    const plain = page();
    paintWaiting(plain.doc, { ...waiting, seats: [{ name: 'Jeff', connected: true }], mySeat: 0 });
    expect(plain.get('roomCode').text()).toBe('ABCD');
    // An N-seat page: one list on the host's waiting screen, one on the guest's, painted alike.
    const p = fakePage([...pageEls(), fakeEl('seatList'), fakeEl('guestSeatList')]);
    // The host's own table of four: seat 1 taken, seat 2 empty, seat 3 named but down.
    const rows = seatRows({
      seats: [
        { name: 'Bo', connected: true },
        { name: null, connected: false },
        { name: 'Di', connected: false },
      ],
      mySeat: 0,
      role: 'host',
      myName: 'Ann',
    });
    expect(rows).toEqual([
      { seat: 0, name: 'Ann', connected: true, you: true },
      { seat: 1, name: 'Bo', connected: true, you: false },
      { seat: 2, name: null, connected: false, you: false },
      { seat: 3, name: 'Di', connected: false, you: false },
    ]);
    expect(rows.map(seatLabel)).toEqual(['Ann · host · you', 'Bo', 'Seat 3 · empty', 'Di']);
    expect(seatListHtml(rows)).toBe(
      '<li data-seat="0" data-connected="true" data-you="">Ann · host · you</li>' +
        '<li data-seat="1" data-connected="true">Bo</li>' +
        '<li data-seat="2" data-connected="false">Seat 3 · empty</li>' +
        '<li data-seat="3" data-connected="false">Di</li>',
    );
    paintWaiting(p.doc, {
      ...waiting,
      seats: [
        { name: 'Bo', connected: true },
        { name: null, connected: false },
        { name: 'Di', connected: false },
      ],
      mySeat: 0,
      role: 'host',
      myName: 'Ann',
    });
    expect(p.get('seatList').text()).toBe(seatListHtml(rows));
    expect(p.get('seatList').attr('data-key')).toBe(seatListKey(rows));
    expect(p.get('guestSeatList').text()).toBe(seatListHtml(rows));
    // A guest at seat 2 sees the host's name first and itself marked; a name is escaped.
    const guest = seatRows({
      seats: [
        { name: 'Bo', connected: true },
        { name: '<Cy>', connected: true },
      ],
      mySeat: 2,
      role: 'guest',
      oppName: 'Ann',
    });
    expect(guest.map(seatLabel)).toEqual(['Ann · host', 'Bo', '<Cy> · you']);
    expect(seatListHtml(guest)).toContain(
      'data-seat="2" data-connected="true" data-you="">&lt;Cy&gt; · you</li>',
    );
    // No room open: no rows, an empty list; a host whose name is unknown reads as an empty host seat.
    expect(seatRows({ seats: [], mySeat: 0, role: 'host', myName: 'Ann' })).toEqual([]);
    // A view with none of the optional fields: no rows; with seats alone, the host is seat 0 unnamed and the viewer.
    expect(seatRows({})).toEqual([]);
    expect(seatRows({ seats: [{ name: 'Bo', connected: true }], role: 'host' })).toEqual([
      { seat: 0, name: null, connected: true, you: true },
      { seat: 1, name: 'Bo', connected: true, you: false },
    ]);
    expect(
      seatRows({ seats: [{ name: 'Bo', connected: true }], role: 'guest', mySeat: 1 })[0],
    ).toEqual({
      seat: 0,
      name: null,
      connected: true,
      you: false,
    });
    paintWaiting(p.doc, { ...waiting, seats: [] });
    expect(p.get('seatList').text()).toBe('');
    expect(seatLabel({ seat: 0, name: null, connected: true, you: false })).toBe(
      'Seat 1 · host · empty',
    );
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

describe('bindButtons', () => {
  const BUTTONS = [
    ['stockPile', { type: 'stock/tap' }],
    ['soundBtn', { type: 'sound/toggle' }],
    ['undoBtn', { type: 'undo/click' }],
  ] as const;

  test("every entry's click dispatches its constant; a disabled control is not skipped by default", () => {
    const p = page();
    const intents: Intent[] = [];
    bindButtons(
      p.doc,
      (i: Intent) => {
        intents.push(i);
      },
      BUTTONS,
    );
    p.get('stockPile').fire('click');
    p.get('soundBtn').fire('click');
    p.get('undoBtn').fire('click');
    p.get('stockPile').fire('pointerdown');
    expect(intents).toEqual([
      { type: 'stock/tap' },
      { type: 'sound/toggle' },
      { type: 'undo/click' },
    ]);
  });

  test('skipDisabled: true drops the click on a disabled control and no other; false drops none', () => {
    const skipping = page();
    const skipped: Intent[] = [];
    bindButtons(
      skipping.doc,
      (i: Intent) => {
        skipped.push(i);
      },
      BUTTONS,
      { skipDisabled: true },
    );
    skipping.get('undoBtn').fire('click');
    skipping.get('soundBtn').fire('click');
    expect(skipped).toEqual([{ type: 'sound/toggle' }]);
    skipping.get('undoBtn').el.removeAttribute('disabled');
    skipping.get('undoBtn').fire('click');
    expect(skipped.at(-1)).toEqual({ type: 'undo/click' });
    const plain = page();
    const all: Intent[] = [];
    bindButtons(
      plain.doc,
      (i: Intent) => {
        all.push(i);
      },
      BUTTONS,
      { skipDisabled: false },
    );
    plain.get('undoBtn').fire('click');
    expect(all).toEqual([{ type: 'undo/click' }]);
  });

  test('a missing id throws at bind time, as listenId does', () => {
    const p = page();
    expect(() => {
      bindButtons(p.doc, () => undefined, [['noSuchBtn', { type: 'x' }]]);
    }).toThrow('missing element #noSuchBtn');
  });
});

describe('bindLongPress', () => {
  const wiredPress = (
    press: Intent | ((e: Readonly<Event>) => Intent | null),
  ): Readonly<{ p: FakePage; intents: Intent[] }> => {
    const p = page();
    const intents: Intent[] = [];
    bindLongPress(
      p.get('hand').el,
      (i: Intent) => {
        intents.push(i);
      },
      { press, release: { type: 'release' } },
    );
    return { p, intents };
  };

  test('a constant press on pointerdown; release on pointerup, pointerleave and pointercancel', () => {
    const { p, intents } = wiredPress({ type: 'press' });
    p.get('hand').fire('pointerdown');
    p.get('hand').fire('pointerup');
    p.get('hand').fire('pointerleave');
    p.get('hand').fire('pointercancel');
    p.get('hand').fire('click');
    expect(intents.map((i) => i.type)).toEqual(['press', 'release', 'release', 'release']);
  });

  test('a press function names the intent from the event, or null for nothing to press', () => {
    const card = fakeEl('card', { attrs: { 'data-card': 'AS' } });
    const { p, intents } = wiredPress((e) => {
      const el = closestFrom(e, '.card');
      return el === null ? null : { type: `press:${dataOf(el, 'card') ?? ''}` };
    });
    p.get('hand').fire('pointerdown');
    expect(intents).toEqual([]);
    p.get('hand').fire('pointerdown', { target: fakeTarget({ closest: { '.card': card } }) });
    p.get('hand').fire('pointerup');
    expect(intents).toEqual([{ type: 'press:AS' }, { type: 'release' }]);
  });
});

describe('paintConnDot', () => {
  test('connDotView reads the two shell fields; connDotClass is the whole attribute both games pinned', () => {
    expect(connDotView({ oppConnected: false, role: null })).toEqual({
      connected: false,
      hidden: false,
    });
    expect(connDotView({ oppConnected: true, role: 'host' })).toEqual({
      connected: true,
      hidden: false,
    });
    expect(connDotView({ oppConnected: true, role: 'local' })).toEqual({
      connected: true,
      hidden: true,
    });
    expect(connDotClass({ connected: false, hidden: false })).toBe('conn-dot off');
    expect(connDotClass({ connected: true, hidden: false })).toBe('conn-dot on');
    expect(connDotClass({ connected: true, hidden: true })).toBe('conn-dot on hidden');
    expect(connDotClass({ connected: false, hidden: true })).toBe('conn-dot off hidden');
  });

  test('writes the class attribute whole (no other class survives) and the tooltip', () => {
    const p = page();
    paintConnDot(p.doc, 'connDot', { connected: true, hidden: false });
    expect(p.get('connDot').attr('class')).toBe('conn-dot on');
    expect(p.get('connDot').attr('title')).toBe('Connected');
    paintConnDot(p.doc, 'connDot', { connected: false, hidden: true });
    expect(p.get('connDot').attr('class')).toBe('conn-dot off hidden');
    expect(p.get('connDot').attr('title')).toBe('Disconnected');
  });
});

describe('paintGate (docs/design/backgammon-landscape.md §5D; the shell`s, for a page that plays sideways)', () => {
  /** A page as page.html lays it out: `#app`, then the overlays as body children, the gate among them; `#toast` is no overlay. */
  const gatedPage = (): FakePage => {
    const app = fakeEl('app');
    const curtain = fakeEl('curtainOverlay', { classes: ['overlay', 'curtain', 'hidden'] });
    const rules = fakeEl('rulesOverlay', { classes: ['overlay', 'hidden'] });
    const gate = fakeEl('turnGate', { classes: ['overlay', 'hidden'] });
    const keep = fakeEl('turnGateKeepBtn', { classes: ['btn'] });
    return fakePage(
      [app, curtain, rules, gate, keep, fakeEl('toast')],
      fakeEl('body', { queries: { '.overlay': [curtain, gate, rules] } }),
    );
  };

  test('open: the gate shows, #app and every other overlay are inert (never the gate, never the toast), focus on Play upright; a repaint leaves focus; closed: all of it gone and the button let go', () => {
    const p = gatedPage();
    paintGate(p.doc, false);
    expect(p.get('turnGate').hidden()).toBe(true);
    ['app', 'curtainOverlay', 'rulesOverlay', 'turnGate', 'toast'].forEach((id) => {
      expect(p.get(id).attr('inert'), id).toBeNull();
    });
    expect(p.get('turnGateKeepBtn').focused()).toBe(false);
    paintGate(p.doc, true);
    expect(p.get('turnGate').hidden()).toBe(false);
    ['app', 'curtainOverlay', 'rulesOverlay'].forEach((id) => {
      expect(p.get(id).attr('inert'), id).toBe('');
    });
    expect(p.get('turnGate').attr('inert')).toBeNull();
    expect(p.get('toast').attr('inert')).toBeNull();
    expect(p.get('turnGateKeepBtn').focused()).toBe(true);
    // The curtain's own hidden class is not the gate's business.
    expect(p.get('curtainOverlay').hidden()).toBe(true);
    // A repaint while open: nothing moves, focus is left where the user put it.
    p.get('turnGateKeepBtn').el.blur();
    paintGate(p.doc, true);
    expect(p.get('turnGateKeepBtn').focused()).toBe(false);
    p.get('turnGateKeepBtn').el.focus();
    paintGate(p.doc, false);
    expect(p.get('turnGate').hidden()).toBe(true);
    ['app', 'curtainOverlay', 'rulesOverlay'].forEach((id) => {
      expect(p.get(id).attr('inert'), id).toBeNull();
    });
    expect(p.get('turnGateKeepBtn').focused()).toBe(false);
  });

  test('a page without the gate (gin`s, briscola`s) is left alone; one with the gate but no #app or button still paints what it has', () => {
    const app = fakeEl('app');
    const rules = fakeEl('rulesOverlay', { classes: ['overlay', 'hidden'] });
    const plain = fakePage([app, rules], fakeEl('body', { queries: { '.overlay': [rules] } }));
    paintGate(plain.doc, true);
    expect(plain.get('app').attr('inert')).toBeNull();
    expect(plain.get('rulesOverlay').attr('inert')).toBeNull();
    // The gate alone (a story page): shown and inert set on the overlays it finds; no button to focus.
    const gate = fakeEl('turnGate', { classes: ['overlay', 'hidden'] });
    const bare = fakePage(
      [gate, rules],
      fakeEl('body', { queries: { '.overlay': [gate, rules] } }),
    );
    paintGate(bare.doc, true);
    expect(bare.get('turnGate').hidden()).toBe(false);
    expect(bare.get('rulesOverlay').attr('inert')).toBe('');
    paintGate(bare.doc, false);
    expect(bare.get('turnGate').hidden()).toBe(true);
    expect(bare.get('rulesOverlay').attr('inert')).toBeNull();
  });

  test('canLock shows "Go sideways" (the Android lock`s tap, docs/design/backgammon-landscape.md §5C) and gives it the focus a dialog owes its first control; without it the button stays hidden and Play upright takes focus; hiding lets whichever go', () => {
    const withGo = (): FakePage => {
      const app = fakeEl('app');
      const gate = fakeEl('turnGate', { classes: ['overlay', 'hidden'] });
      const go = fakeEl('turnGateGoBtn', { classes: ['btn', 'hidden'] });
      const keep = fakeEl('turnGateKeepBtn', { classes: ['btn'] });
      return fakePage([app, gate, go, keep], fakeEl('body', { queries: { '.overlay': [gate] } }));
    };
    const android = withGo();
    paintGate(android.doc, true, true);
    expect(android.get('turnGate').hidden()).toBe(false);
    expect(android.get('turnGateGoBtn').hidden()).toBe(false);
    expect(android.get('turnGateGoBtn').focused()).toBe(true);
    expect(android.get('turnGateKeepBtn').focused()).toBe(false);
    // A repaint while open leaves focus where the player put it.
    android.get('turnGateGoBtn').el.blur();
    android.get('turnGateKeepBtn').el.focus();
    paintGate(android.doc, true, true);
    expect(android.get('turnGateGoBtn').focused()).toBe(false);
    expect(android.get('turnGateKeepBtn').focused()).toBe(true);
    // Hidden: the button that had focus lets go.
    paintGate(android.doc, false, true);
    expect(android.get('turnGateKeepBtn').focused()).toBe(false);
    expect(android.get('turnGateGoBtn').hidden()).toBe(false);
    // The device fact can change between paints only in a test; the paint follows it either way.
    paintGate(android.doc, false);
    expect(android.get('turnGateGoBtn').hidden()).toBe(true);
    // An iPhone (no canLock, the default): the one control, as before.
    const iphone = withGo();
    paintGate(iphone.doc, true);
    expect(iphone.get('turnGateGoBtn').hidden()).toBe(true);
    expect(iphone.get('turnGateGoBtn').focused()).toBe(false);
    expect(iphone.get('turnGateKeepBtn').focused()).toBe(true);
    paintGate(iphone.doc, false);
    expect(iphone.get('turnGateKeepBtn').focused()).toBe(false);
    // A gated page without the Go button (a story) under canLock: Play upright takes focus.
    const noGo = fakePage(
      [fakeEl('turnGate', { classes: ['overlay', 'hidden'] }), fakeEl('turnGateKeepBtn')],
      fakeEl('body', { queries: { '.overlay': [] } }),
    );
    paintGate(noGo.doc, true, true);
    expect(noGo.get('turnGateKeepBtn').focused()).toBe(true);
    paintGate(noGo.doc, false, true);
    expect(noGo.get('turnGateKeepBtn').focused()).toBe(false);
  });
});

describe('paintFlip (shell.ts `flipped`; docs/design/backgammon-landscape.md §6 item 7)', () => {
  test('`data-flip="1"` on the body while the table is turned for the far seat, removed otherwise; the attribute alone, no class', () => {
    const p = page();
    expect(p.body.attr('data-flip')).toBeNull();
    paintFlip(p.doc, true);
    expect(p.body.attr('data-flip')).toBe('1');
    expect(p.body.classes()).toEqual([]);
    paintFlip(p.doc, true);
    expect(p.body.attr('data-flip')).toBe('1');
    paintFlip(p.doc, false);
    expect(p.body.attr('data-flip')).toBeNull();
    paintFlip(p.doc, false);
    expect(p.body.attr('data-flip')).toBeNull();
  });
});
