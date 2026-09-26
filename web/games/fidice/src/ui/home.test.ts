// No jsdom here (docs/ARCHITECTURE.md "Testing pyramid"): the home screen runs against the page
// fake built from the page's own markup (ui/page.fake.ts over web/games/fidice/index.html). The
// fake knows no `<option selected>`, so a test sets a select's value as a player would pick it.
import { describe, expect, test } from 'vitest';

import {
  CODE_LENGTH,
  EXTRA_NAME_INPUTS,
  HOST_SELECTS,
  bindHome,
  fillNameInputs,
  fillP2NameInput,
  handoffLabel,
  paintHome,
  readHostOptions,
  readLocalOptions,
  resumeLabel,
  seatNames,
  setCodeInput,
} from './home.ts';
import { must } from '../../../../../test/shared/engine-helpers.ts';
import { newGame } from '../domain/game.ts';
import { makeHuman, seatPlayer } from '../domain/lobby.ts';
import type { State } from '../domain/types.ts';
import { fidicePage, type FidicePage } from './page.fake.ts';
import {
  DEFAULT_OPTS,
  initialApp,
  type App,
  type Intent,
  type Mode,
  type Resume,
} from './state.ts';

import MARKUP from '../../index.html?raw';

const page = (): FidicePage => fidicePage(MARKUP);
/** Type into an input, or pick a select's option, as the player would. */
const type = (p: FidicePage, id: string, value: string): void => {
  const input = p.get(id).el as HTMLInputElement;
  input.value = value;
};
/** A page with the four selects at their shipped defaults, as a browser would report them. */
const defaults = (p: FidicePage): void => {
  type(p, HOST_SELECTS.lives, '0');
  type(p, HOST_SELECTS.seats, '6');
  type(p, HOST_SELECTS.bots, '0');
  type(p, HOST_SELECTS.difficulty, 'medium');
};
const withMode = (
  mode: Mode,
  extraNames: Partial<App['table']['extraNames']> = {},
  opts: Partial<App['shell']['opts']> = {},
): App => ({
  shell: { ...initialApp.shell, playMode: mode, opts: { ...DEFAULT_OPTS, ...opts } },
  table: { ...initialApp.table, extraNames: { ...initialApp.table.extraNames, ...extraNames } },
});
const recorder = (): Readonly<{ intents: Intent[]; dispatch: (i: Intent) => void }> => {
  const intents: Intent[] = [];
  return { intents, dispatch: (i) => intents.push(i) };
};

describe('the input writes the reducer raises as effects', () => {
  test('fillNameInputs writes both first-name inputs (marked when a default), fillP2NameInput the second seat, setCodeInput the code', () => {
    const p = page();
    fillNameInputs(p.doc, 'Ann', true);
    expect(p.get('nameInput').value()).toBe('Ann');
    expect(p.get('p1NameInput').value()).toBe('Ann');
    expect(p.get('nameInput').attr('data-default')).toBe('1');
    fillNameInputs(p.doc, 'Ari');
    expect(p.get('nameInput').attr('data-default')).toBeNull();
    fillP2NameInput(p.doc, 'Bob');
    expect(p.get('p2NameInput').value()).toBe('Bob');
    setCodeInput(p.doc, 'ABCDE');
    expect(p.get('codeInput').value()).toBe('ABCDE');
  });
});

describe('the readers', () => {
  test('readHostOptions reads the four selects; readLocalOptions adds the shown extra seats alone', () => {
    const p = page();
    defaults(p);
    type(p, HOST_SELECTS.bots, '2');
    type(p, HOST_SELECTS.lives, '3');
    expect(readHostOptions(p.doc)).toEqual({
      lives: '3',
      seats: '6',
      bots: '2',
      difficulty: 'medium',
    });
    // The markup ships the third to sixth inputs hidden: none is carried.
    expect(readLocalOptions(p.doc)).toEqual(readHostOptions(p.doc));
    paintHome(p.doc, withMode('local', { 2: 'Cara', 3: '' }));
    type(p, EXTRA_NAME_INPUTS[3], 'Dan');
    expect(readLocalOptions(p.doc)).toEqual({ ...readHostOptions(p.doc), p3: 'Cara', p4: 'Dan' });
  });
});

describe('the labels', () => {
  test('seatNames, handoffLabel and resumeLabel in their forms', () => {
    expect(seatNames(['Ann', 'Bob'])).toBe('Ann vs Bob');
    expect(seatNames(['Ann', 'Bob', 'Cara'])).toBe('Ann, Bob and Cara');
    const game: State = must(
      seatPlayer(
        must(seatPlayer(newGame('ABCDE', 0), makeHuman('host', 'Ann', 0))),
        makeHuman('guest', 'Bob', 0),
      ),
    );
    expect(handoffLabel(game)).toBe('Continue online: Ann hosts, Bob joins by invite');
    expect(resumeLabel({ kind: 'local', game })).toBe('Resume pass & play: Ann vs Bob');
    expect(resumeLabel({ kind: 'guest', code: 'ABCDE', myName: 'Bob' })).toBe('Rejoin room ABCDE');
    const host: Resume = {
      kind: 'host',
      code: 'ABCDE',
      myName: 'Ann',
      ...DEFAULT_OPTS,
      game: null,
      oppName: null,
      handoff: false,
      at: null,
    };
    expect(resumeLabel(host)).toBe('Resume hosting room ABCDE');
    expect(resumeLabel({ ...host, game, handoff: true })).toBe(handoffLabel(game));
    expect(resumeLabel({ ...host, game: null, handoff: true })).toBe('Resume hosting room ABCDE');
  });
});

describe('paintHome', () => {
  test('the code input takes five characters (the shell partial ships gin`s four; the page fake reads no maxlength off the markup)', () => {
    const p = page();
    paintHome(p.doc, withMode('online'));
    expect(CODE_LENGTH).toBe(5);
    expect(p.get('codeInput').attr('maxlength')).toBe('5');
  });

  test('Online shows the online panel alone; the host card`s selects follow the room`s terms', () => {
    const p = page();
    paintHome(
      p.doc,
      withMode('online', {}, { lives: 2, seatCount: 4, bots: 3, botChoice: 'gambler' }),
    );
    expect(p.get('onlineModeContent').hidden()).toBe(false);
    expect(p.get('localModeContent').hidden()).toBe(true);
    expect(p.get(HOST_SELECTS.lives).value()).toBe('2');
    expect(p.get(HOST_SELECTS.seats).value()).toBe('4');
    expect(p.get(HOST_SELECTS.bots).value()).toBe('3');
    expect(p.get(HOST_SELECTS.difficulty).value()).toBe('hard');
    // An exact strategy no difficulty means leaves the difficulty select where it was.
    paintHome(p.doc, withMode('online', {}, { botChoice: 'learner-100' }));
    expect(p.get(HOST_SELECTS.difficulty).value()).toBe('hard');
  });

  test('Pass the phone shows two names, the remembered extra seats with their names, add while a seat is free and remove while one is seated', () => {
    const p = page();
    paintHome(p.doc, withMode('local'));
    expect(p.get('localModeContent').hidden()).toBe(false);
    expect(p.get('p1NameInput').hidden()).toBe(false);
    expect(p.get('p2NameInput').hidden()).toBe(false);
    expect(p.get(EXTRA_NAME_INPUTS[2]).hidden()).toBe(true);
    expect(p.get('addLocalBtn').hidden()).toBe(false);
    expect(p.get('removeLocalBtn').hidden()).toBe(true);
    paintHome(p.doc, withMode('local', { 2: 'Cara', 3: '' }));
    expect(p.get(EXTRA_NAME_INPUTS[2]).hidden()).toBe(false);
    expect(p.get(EXTRA_NAME_INPUTS[2]).value()).toBe('Cara');
    expect(p.get(EXTRA_NAME_INPUTS[3]).hidden()).toBe(false);
    expect(p.get(EXTRA_NAME_INPUTS[4]).hidden()).toBe(true);
    expect(p.get('removeLocalBtn').hidden()).toBe(false);
    paintHome(p.doc, withMode('local', { 2: 'C', 3: 'D', 4: 'E', 5: 'F' }));
    expect(p.get('addLocalBtn').hidden()).toBe(true);
    expect(p.get(EXTRA_NAME_INPUTS[5]).hidden()).toBe(false);
  });

  test('Solo shows the first name alone; Watch none; neither adds or removes seats (D9)', () => {
    const p = page();
    paintHome(p.doc, withMode('solo', { 2: 'Cara' }));
    expect(p.get('localModeContent').hidden()).toBe(false);
    expect(p.get('p1NameInput').hidden()).toBe(false);
    expect(p.get('p2NameInput').hidden()).toBe(true);
    expect(p.get(EXTRA_NAME_INPUTS[2]).hidden()).toBe(true);
    expect(p.get('addLocalBtn').hidden()).toBe(true);
    expect(p.get('removeLocalBtn').hidden()).toBe(true);
    paintHome(p.doc, withMode('watch'));
    expect(p.get('localModeContent').hidden()).toBe(false);
    expect(p.get('p1NameInput').hidden()).toBe(true);
    expect(p.get('p2NameInput').hidden()).toBe(true);
    // The mode buttons wear `active` for the mode shown, all four being on the switch.
    expect(p.modeButtons.find((b) => b.attr('data-mode') === 'watch')?.hasClass('active')).toBe(
      true,
    );
    expect(p.modeButtons.find((b) => b.attr('data-mode') === 'online')?.hasClass('active')).toBe(
      false,
    );
  });

  test('another tab leaves the panels as they were (the shell`s legacy trait)', () => {
    const p = page();
    paintHome(p.doc, withMode('local'));
    paintHome(p.doc, {
      ...withMode('online'),
      shell: { ...withMode('online').shell, homeTab: 'rules' },
    });
    expect(p.get('localModeContent').hidden()).toBe(false);
    expect(p.get('rulesPanel').hidden()).toBe(false);
    expect(p.get('playPanel').hidden()).toBe(true);
  });
});

describe('bindHome', () => {
  test('the shell`s controls carry fidice`s raw options: host with the card`s terms, local with the terms and the shown extra names', () => {
    const p = page();
    defaults(p);
    const { intents, dispatch } = recorder();
    bindHome(p.doc, dispatch);
    type(p, 'nameInput', 'Ann');
    type(p, HOST_SELECTS.bots, '2');
    p.get('hostBtn').fire('click');
    expect(intents).toEqual([
      { type: 'host/click', name: 'Ann', lives: '0', seats: '6', bots: '2', difficulty: 'medium' },
    ]);
    intents.length = 0;
    paintHome(p.doc, withMode('local', { 2: 'Cara' }));
    // The paint wrote the room's terms back into the selects; the player picks two computers again.
    type(p, HOST_SELECTS.bots, '2');
    type(p, 'p1NameInput', 'Ann');
    type(p, 'p2NameInput', 'Bob');
    p.get('localBtn').fire('click');
    expect(intents).toEqual([
      {
        type: 'local/click',
        p1: 'Ann',
        p2: 'Bob',
        lives: '0',
        seats: '6',
        bots: '2',
        difficulty: 'medium',
        p3: 'Cara',
      },
    ]);
  });

  test('a select`s change remembers the terms at once; an extra name is remembered as typed; add seats the first free seat, remove unseats the last; the strategy button opens its screen', () => {
    const p = page();
    defaults(p);
    const { intents, dispatch } = recorder();
    bindHome(p.doc, dispatch);
    type(p, HOST_SELECTS.lives, '3');
    p.get(HOST_SELECTS.lives).fire('change');
    expect(intents).toEqual([
      { type: 'opts/set', raw: { lives: '3', seats: '6', bots: '0', difficulty: 'medium' } },
    ]);
    intents.length = 0;
    paintHome(p.doc, withMode('local', { 2: 'Cara' }));
    type(p, EXTRA_NAME_INPUTS[2], 'Car');
    p.get(EXTRA_NAME_INPUTS[2]).fire('input');
    p.get('addLocalBtn').fire('click');
    p.get('removeLocalBtn').fire('click');
    p.get('btnConfigSolo').fire('click');
    expect(intents).toEqual([
      { type: 'pname/typed', seat: 2, value: 'Car' },
      { type: 'pname/typed', seat: 3, value: '' },
      { type: 'pname/drop', seat: 2 },
      { type: 'config/open', target: { kind: 'solo' } },
    ]);
    // Every seat shown: add finds none; none shown: remove finds none.
    intents.length = 0;
    paintHome(p.doc, withMode('local', { 2: 'C', 3: 'D', 4: 'E', 5: 'F' }));
    p.get('addLocalBtn').fire('click');
    paintHome(p.doc, withMode('local'));
    p.get('removeLocalBtn').fire('click');
    expect(intents).toEqual([]);
  });
});
