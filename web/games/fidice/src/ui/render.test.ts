// No jsdom here (docs/ARCHITECTURE.md "Testing pyramid"): the paint runs against the page fake
// built from the page's own markup (ui/page.fake.ts over web/games/fidice/index.html), so every id,
// initial class and value is the real one; the four vdom mounts run against a document spliced
// from web/shared/edge/dom.fake.ts (the structural DOM the view tests render into), so the legacy
// builders' trees are read back and their handlers fired. The Apps come from the reducer driven
// the way the page drives it (a pass-the-phone start, a hosted deal).
import { describe, expect, test } from 'vitest';

import { NOW, runIntents } from '../../../../../test/shared/engine-helpers.ts';
import { byId, fakeDocument, fire, serialize } from '../../../../shared/edge/dom.fake.ts';
import { mulberry32 } from '../../../../shared/lib/rng.ts';
import { asRank } from '../domain/hands.ts';
import type { Intent as OldIntent } from '../view/types.ts';
import { fidicePage, type FidicePage } from './page.fake.ts';
import {
  MOUNT_IDS,
  bindAll,
  intentOf,
  paint,
  paintHandoff,
  paintNames,
  paintScreen,
  paintSound,
  paintTable,
  paintWaiting,
  renderAbout,
  renderRules,
  uiOf,
  type PageLike,
} from './render.ts';
import {
  DEFAULT_OPTS,
  SCREENS,
  initialApp,
  reduce,
  type App,
  type HomeSnapshot,
  type Intent,
} from './state.ts';

import MARKUP from '../../index.html?raw';

const ctx = { rng: mulberry32(7), now: () => NOW };
const run = runIntents(reduce, ctx);
const home: HomeSnapshot = {
  name: null,
  p2Name: null,
  homeTab: 'play',
  playMode: 'online',
  soundFont: 'default',
  save: null,
  recentGames: [],
  opts: DEFAULT_OPTS,
  extraNames: { 2: null, 3: null, 4: null, 5: null },
};
/** Ann and Bob at one phone, dealt (the curtain up for the holder). */
const local = (bots = '0'): App =>
  run(
    initialApp,
    { type: 'home/init', home },
    { type: 'mode/set', mode: 'local' },
    { type: 'local/click', p1: 'Ann', p2: 'Bob', bots },
  ).app;
/** Ann hosting with Bob connected and two computers, dealt. */
const hosted = (): App => {
  const room: App = {
    ...initialApp,
    shell: {
      ...initialApp.shell,
      role: 'host',
      code: 'ABCDE',
      myName: 'Ann',
      opts: { ...DEFAULT_OPTS, seatCount: 4, bots: 2 },
      seats: [
        { name: 'Bob', connected: true },
        { name: null, connected: false },
        { name: null, connected: false },
      ],
      oppName: 'Bob',
      oppConnected: true,
      screen: 'hostWaitScreen',
    },
  };
  return run(room, { type: 'host/deal' }).app;
};
/** Watch: computers alone, the host standing. */
const watching = (): App =>
  run(
    initialApp,
    { type: 'home/init', home },
    { type: 'mode/set', mode: 'watch' },
    { type: 'local/click', p1: '', p2: '' },
  ).app;

type Mountable = Readonly<{
  page: FidicePage;
  doc: PageLike;
  roots: Readonly<Record<string, ReturnType<ReturnType<typeof fakeDocument>['createElement']>>>;
}>;
/**
 * The structural DOM's element as a mount root: a `classList` over its class attribute
 * (`#configScreen` is a screen the shell toggles and a mount root) and `replaceChildren` (the DOM
 * edge's `clear`), neither of which dom.fake.ts carries.
 */
const asRoot = (el: ReturnType<ReturnType<typeof fakeDocument>['createElement']>) => {
  const classes = (): Set<string> =>
    new Set((el.getAttribute('class') ?? '').split(/\s+/).filter((c) => c !== ''));
  const write = (set: ReadonlySet<string>): void => {
    el.setAttribute('class', [...set].join(' '));
  };
  const classList = {
    toggle: (name: string, on: boolean): void => {
      const set = classes();
      if (on) set.add(name);
      else set.delete(name);
      write(set);
    },
    contains: (name: string): boolean => classes().has(name),
  };
  const replaceChildren = (): void => {
    [...el.childNodes].forEach((child) => {
      el.removeChild(child);
    });
  };
  return Object.assign(el, { classList, replaceChildren });
};
/** The page fake with the four mount roots and the constructors from the structural DOM, so the vdom can mount. */
const mountable = (): Mountable => {
  const page = fidicePage(MARKUP);
  const fd = fakeDocument();
  const roots = Object.fromEntries(
    Object.values(MOUNT_IDS).map((id) => [id, asRoot(fd.createElement('div'))] as const),
  );
  const doc = {
    getElementById: (id: string) => roots[id] ?? page.doc.getElementById(id),
    body: page.doc.body,
    addEventListener: page.doc.addEventListener,
    createElement: fd.createElement,
    createTextNode: fd.createTextNode,
  } as unknown as PageLike;
  return { page, doc, roots };
};
const root = (m: Mountable, id: string): NonNullable<Mountable['roots'][string]> => {
  const el = m.roots[id];
  if (el === undefined) throw new Error(`no root ${id}`);
  return el;
};
const recorder = (): Readonly<{ intents: Intent[]; dispatch: (i: Intent) => void }> => {
  const intents: Intent[] = [];
  return { intents, dispatch: (i) => intents.push(i) };
};

describe('the static markup rendered at boot', () => {
  test('renderRules fills both slots with the same list; renderAbout the About copy', () => {
    const p = fidicePage(MARKUP);
    renderRules(p.doc);
    expect(p.get('rulesList').text()).toContain('<li id="rule-goal">');
    expect(p.get('rulesOverlayList').text()).toBe(p.get('rulesList').text());
    renderAbout(p.doc);
    expect(p.get('aboutCopy').text()).toContain('Kezar Lake');
  });
});

describe('the shell painters over the App', () => {
  test('paintScreen shows one of the six screens and locks the body on the table; paintSound writes the glyph and aria-pressed', () => {
    const p = fidicePage(MARKUP);
    paintScreen(p.doc, initialApp);
    SCREENS.forEach((id) => {
      expect(p.get(id).hidden(), id).toBe(id !== 'homeScreen');
    });
    expect(p.body.hasClass('fixed-screen')).toBe(false);
    paintScreen(p.doc, hosted());
    expect(p.get('tableScreen').hidden()).toBe(false);
    expect(p.body.hasClass('fixed-screen')).toBe(true);
    paintSound(p.doc, false);
    expect(p.get('soundBtn').text()).toBe('🔇');
    expect(p.get('soundBtn').attr('aria-pressed')).toBe('false');
    paintSound(p.doc, true);
    expect(p.get('soundBtn').attr('aria-pressed')).toBe('true');
  });

  test('paintWaiting lists the host, the guest seats and the room`s computers with the host`s controls', () => {
    const p = fidicePage(MARKUP);
    const app = hosted();
    paintWaiting(p.doc, { ...app, shell: { ...app.shell, screen: 'hostWaitScreen' } });
    expect(p.get('roomCode').text()).toBe('ABCDE');
    const list = p.get('seatList').text();
    expect(list).toContain('Ann · host · you');
    expect(list).toContain('>Bob<');
    expect(list).toContain('data-bot-remove data-bot="1"');
  });

  test('paintHandoff offers the two-seat room for two humans at one phone and nothing otherwise', () => {
    const p = fidicePage(MARKUP);
    paintHandoff(p.doc, local());
    expect(p.get('handoffBtn').hidden()).toBe(false);
    expect(p.get('handoffBtn').attr('title')).toBe(
      'Continue online: Ann hosts, Bob joins by invite',
    );
    paintHandoff(p.doc, local('1'));
    expect(p.get('handoffBtn').hidden()).toBe(true);
    paintHandoff(p.doc, hosted());
    expect(p.get('handoffBtn').hidden()).toBe(true);
  });

  test('paintNames: my chair and the other seats; the cup holder`s under pass the phone; Watching with no chair; empty off the table', () => {
    const p = fidicePage(MARKUP);
    /** The computers' names as the engine drew them (domain/lobby.ts), in chair order. */
    const bots = (app: App): ReadonlyArray<string> =>
      (app.shell.view?.players ?? []).filter((pl) => pl.bot !== null).map((pl) => pl.name);
    const room = hosted();
    paintNames(p.doc, room);
    expect(p.get('myName').text()).toBe('Ann');
    expect(p.get('oppName').text()).toBe(['Bob', ...bots(room)].join(' · '));
    const app = local();
    paintNames(p.doc, app);
    const holder = app.shell.view?.round?.holder ?? 0;
    expect(p.get('myName').text()).toBe(holder === 0 ? 'Ann' : 'Bob');
    expect(p.get('oppName').text()).toBe(holder === 0 ? 'Bob' : 'Ann');
    const watch = watching();
    paintNames(p.doc, watch);
    expect(p.get('myName').text()).toBe('Watching');
    expect(bots(watch)).toHaveLength(4);
    expect(p.get('oppName').text()).toBe(bots(watch).join(' · '));
    paintNames(p.doc, initialApp);
    expect(p.get('myName').text()).toBe('');
    expect(p.get('oppName').text()).toBe('');
  });

  test('paint over the page fake (no constructors): every shell write lands and no mount is attempted', () => {
    const p = fidicePage(MARKUP);
    const app = run(hosted(), { type: 'ladder/open' }, { type: 'history/open' }).app;
    paint(p.doc, app);
    expect(p.get('tableScreen').hidden()).toBe(false);
    expect(p.get('ladderOverlay').hidden()).toBe(false);
    expect(p.get('historyOverlay').hidden()).toBe(false);
    expect(p.get('rulesOverlay').hidden()).toBe(true);
    expect(p.get('connDot').attr('class')).toBe('conn-dot on');
    expect(p.get('fidiceTable').text()).toBe('');
    paint(p.doc, local());
    expect(p.get('connDot').attr('class')).toBe('conn-dot on hidden');
    expect(p.get('curtainOverlay').hidden()).toBe(false);
  });
});

describe('uiOf: the App as the legacy builders read it', () => {
  test('a hosted game: the host`s chair, the host role, the view, the table`s memory; a guest is a player', () => {
    const app = hosted();
    const ui = uiOf(app, NOW);
    expect(ui.role).toBe('host');
    expect(ui.mySeat).toBe(0);
    expect(ui.screen).toBe('game');
    expect(ui.game).toBe(app.shell.view);
    expect(ui.now).toBe(NOW);
    expect(ui.handoff).toBeNull();
    expect(ui.configTarget).toBeNull();
    expect(ui.nameForm.botChoice).toBe(DEFAULT_OPTS.botChoice);
    expect(ui.ladders.main.open).toEqual(new Set());
    const guest = uiOf({ ...app, shell: { ...app.shell, role: 'guest', mySeat: 1 } }, NOW);
    expect(guest.role).toBe('player');
    expect(guest.mySeat).toBe(1);
  });

  test('Watch: no chair, the spectator screen; a strategy screen target is always the card`s (D7); the memory`s lists become sets', () => {
    const app = run(watching(), { type: 'config/open', target: { kind: 'bot', index: 1 } }).app;
    const ui = uiOf(app, NOW);
    expect(ui.mySeat).toBeNull();
    expect(ui.screen).toBe('spec');
    expect(ui.configTarget).toEqual({ kind: 'solo' });
    const picked = run(
      app,
      { type: 'roll/toggleDie', die: 2 },
      { type: 'ladder/toggle', id: 'main', key: 'cat:five' },
    ).app;
    const u = uiOf(picked, NOW);
    expect(u.rollSelection).toEqual(new Set([2]));
    expect(u.ladders.main.open).toEqual(new Set(['cat:five']));
  });

  test('pass the phone: the chair is the cup holder`s, whose view is shown', () => {
    const app = local();
    const ui = uiOf(app, NOW);
    expect(ui.role).toBe('host');
    expect(ui.localTable).toBe(true);
    expect(ui.mySeat).toBe(app.shell.view?.round?.holder);
  });
});

describe('intentOf: the legacy builders` intents as the reducer`s', () => {
  const app = hosted();
  const cases: ReadonlyArray<readonly [OldIntent, Intent | null]> = [
    [
      { type: 'play', action: { type: 'call' } },
      { type: 'act', action: { type: 'call' } },
    ],
    [
      { type: 'roll.toggleDie', die: 3 },
      { type: 'roll/toggleDie', die: 3 },
    ],
    [
      { type: 'roll.cup', on: true },
      { type: 'roll/cup', on: true },
    ],
    [
      { type: 'roll.hidden', on: false },
      { type: 'roll/hidden', on: false },
    ],
    [{ type: 'roll.go' }, { type: 'roll/go' }],
    [
      { type: 'picker.query', value: '3s' },
      { type: 'picker/query', value: '3s' },
    ],
    [{ type: 'picker.focus' }, { type: 'picker/query', value: '' }],
    [
      { type: 'picker.move', delta: 1 },
      { type: 'picker/move', delta: 1 },
    ],
    [
      { type: 'picker.choose', rank: asRank(9) },
      { type: 'picker/choose', rank: asRank(9) },
    ],
    [{ type: 'picker.close' }, { type: 'picker/close' }],
    [{ type: 'picker.enter' }, { type: 'picker/enter' }],
    [{ type: 'picker.place' }, { type: 'bid/place' }],
    [
      { type: 'ladder.toggle', ladder: 'spec', key: 'k' },
      { type: 'ladder/toggle', id: 'spec', key: 'k' },
    ],
    [
      { type: 'ladder.expandAll', ladder: 'main' },
      { type: 'ladder/all', id: 'main', open: true },
    ],
    [
      { type: 'ladder.jump', cat: 'five' },
      { type: 'ladder/toggle', id: 'main', key: 'cat:five' },
    ],
    [{ type: 'ladder.showBid' }, { type: 'ladder/open' }],
    [{ type: 'spec.truth', on: true }, { type: 'truth/toggle' }],
    [{ type: 'spec.truth', on: false }, null],
    [
      { type: 'config.open', target: { kind: 'solo' } },
      { type: 'config/open', target: { kind: 'solo' } },
    ],
    [{ type: 'config.close' }, { type: 'config/close' }],
    [
      { type: 'config.pick', choice: 'gambler' },
      { type: 'config/pick', choice: 'gambler' },
    ],
    [{ type: 'lobby.start' }, { type: 'host/deal' }],
    [{ type: 'lobby.addBot' }, { type: 'bots/add' }],
    [
      { type: 'lobby.setBot', seat: 2, choice: 'trapper' },
      { type: 'bots/config', choice: 'trapper' },
    ],
    [
      { type: 'lobby.watch', watching: true },
      { type: 'watch/toggle', on: true },
    ],
    [{ type: 'leave' }, { type: 'leave/request' }],
    [{ type: 'handoff.tap' }, { type: 'curtain/reveal' }],
    [{ type: 'handoff.confirm' }, { type: 'curtain/reveal' }],
    [{ type: 'nav', tab: 'ladder' }, null],
    [{ type: 'menu.create' }, null],
    [{ type: 'form.submit' }, null],
    [{ type: 'copy', text: 'x' }, null],
  ];
  test.each(cases)('%j', (old, expected) => {
    expect(intentOf(app, old)).toEqual(expected);
  });

  test('the computers` chairs map to their index among the computers (a human`s chair to 0); a jump onto an open category is nothing; expand-all closes an open ladder', () => {
    const view = app.shell.view;
    if (view === null) throw new Error('no view');
    const chairs = view.players.map((p) => p.id);
    expect(chairs).toEqual(['host', 'guest', 'bot0', 'bot1']);
    expect(intentOf(app, { type: 'lobby.removeBot', seat: 3 })).toEqual({
      type: 'bots/remove',
      index: 1,
    });
    expect(intentOf(app, { type: 'lobby.renameBot', seat: 2, name: 'Rex' })).toEqual({
      type: 'bots/rename',
      index: 0,
      name: 'Rex',
    });
    expect(intentOf(app, { type: 'config.open', target: { kind: 'seat', seat: 3 } })).toEqual({
      type: 'config/open',
      target: { kind: 'bot', index: 1 },
    });
    expect(intentOf(app, { type: 'config.open', target: { kind: 'seat', seat: 0 } })).toEqual({
      type: 'config/open',
      target: { kind: 'bot', index: 0 },
    });
    const opened = run(app, { type: 'ladder/toggle', id: 'main', key: 'cat:five' }).app;
    expect(intentOf(opened, { type: 'ladder.jump', cat: 'five' })).toBeNull();
    const all = run(app, { type: 'ladder/all', id: 'main', open: true }).app;
    expect(intentOf(all, { type: 'ladder.jump', cat: 'five' })).toBeNull();
    expect(intentOf(all, { type: 'ladder.expandAll', ladder: 'main' })).toEqual({
      type: 'ladder/all',
      id: 'main',
      open: false,
    });
  });
});

describe('paintTable: the legacy builders mounted where the App shows them', () => {
  test('nothing mounts before bindAll hands over the dispatch; after it, the game screen for a chair, read back and its handlers reaching the reducer', () => {
    const m = mountable();
    const app = hosted();
    paintTable(m.doc, app, NOW);
    expect(root(m, MOUNT_IDS.table).childNodes).toHaveLength(0);
    const { intents, dispatch } = recorder();
    bindAll(m.doc, dispatch);
    paint(m.doc, app);
    const table = root(m, MOUNT_IDS.table);
    expect(table.childNodes).toHaveLength(1);
    const html = serialize(table);
    expect(html).toContain('id="screen-game"');
    expect(html).toContain('Round 1');
    expect(html).toContain('Bob');
    expect(root(m, MOUNT_IDS.ladder).childNodes).toHaveLength(0);
    expect(root(m, MOUNT_IDS.sheet).childNodes).toHaveLength(0);
    expect(root(m, MOUNT_IDS.config).childNodes).toHaveLength(0);
    const leave = byId(table, 'btnLeaveGame');
    if (leave === null) throw new Error('no leave button');
    fire(leave, 'click');
    expect(intents).toEqual([{ type: 'leave/request' }]);
    // The table's shell controls are bound too.
    m.page.get('ladderBtn').fire('click');
    m.page.get('rulesBtnGame').fire('click');
    m.page.get('historyBtn').fire('click');
    m.page.get('closeLadderBtn').fire('click');
    expect(intents.slice(1)).toEqual([
      { type: 'ladder/open' },
      { type: 'rules/open' },
      { type: 'history/open' },
      { type: 'ladder/close' },
    ]);
  });

  test('the spectator screen for Watch; the ladder sheet while open over the table; the Ladder tab on the home screen; the strategy screen with a target; each root cleared when its App moves on', () => {
    const m = mountable();
    const { dispatch } = recorder();
    bindAll(m.doc, dispatch);
    const watch = watching();
    paint(m.doc, watch);
    expect(serialize(root(m, MOUNT_IDS.table))).toContain('id="screen-spec"');
    paint(m.doc, run(watch, { type: 'ladder/open' }).app);
    expect(serialize(root(m, MOUNT_IDS.sheet))).toContain('id="mainLadder"');
    expect(root(m, MOUNT_IDS.ladder).childNodes).toHaveLength(0);
    paint(m.doc, run(watch, { type: 'config/open', target: { kind: 'solo' } }).app);
    expect(serialize(root(m, MOUNT_IDS.config))).toContain('id="screen-config"');
    expect(root(m, MOUNT_IDS.sheet).childNodes).toHaveLength(0);
    const homeLadder = run(
      initialApp,
      { type: 'home/init', home },
      { type: 'tab/set', tab: 'ladder' },
    ).app;
    paint(m.doc, homeLadder);
    expect(serialize(root(m, MOUNT_IDS.ladder))).toContain('id="tab-ladder"');
    expect(root(m, MOUNT_IDS.table).childNodes).toHaveLength(0);
    expect(root(m, MOUNT_IDS.config).childNodes).toHaveLength(0);
    paint(m.doc, run(homeLadder, { type: 'tab/set', tab: 'play' }).app);
    expect(root(m, MOUNT_IDS.ladder).childNodes).toHaveLength(0);
  });
});
