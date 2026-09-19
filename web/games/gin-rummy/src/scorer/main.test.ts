// No jsdom here (docs/ARCHITECTURE.md "Testing pyramid"): the Score Counter runs against the page
// fake built from the page's markup (ui/page.fake.ts), the board's and the history's generated
// controls handed out fresh on every render (the real DOM recreates them too), and every dependency
// recorded: storage, the clock, the dialogs, the screens, the download and a fake SpeechRecognition.
import { describe, expect, test } from 'vitest';

import { fakeEl, type FakeEl } from '../../../../shared/edge/page.fake.ts';
import { createStore, type StorageLike } from '../../../../shared/edge/storage.ts';
import { mulberry32 } from '../../../../shared/lib/rng.ts';
import { STORAGE_KEYS } from '../storage.ts';
import { ginPage, type GinPage } from '../ui/page.fake.ts';
import {
  ADD_TWO_MSG,
  EXPORTED_MSG,
  LEAVE_MSG,
  LISTENING_MSG,
  MIC_BLOCKED_MSG,
  NEED_TWO_MSG,
  NOTHING_TO_EXPORT_MSG,
  NO_SPEECH_MSG,
  NO_SUCH_PLAYER_MSG,
  NO_VOICE_MSG,
  PICK_KNOCKER_MSG,
  VOICE_START_FAILED_MSG,
  createScorer,
  deleteHandMsg,
  durationText,
  heardMsg,
  notHeardMsg,
  playerCardHtml,
  resultRowsHtml,
  scorerHistoryHtml,
  standingsHtml,
  type ScorerDeps,
  type SpeechRecognizerLike,
} from './main.ts';
import type { ScorerState } from './scores.ts';

import MARKUP from '../../index.html?raw';

const NOW = 1_700_000_000_000;

const fakeStorage = (): StorageLike & Readonly<{ map: Map<string, string> }> => {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
};

/** One board card's controls, as the markup renders them. */
type Card = Readonly<{
  card: FakeEl;
  dw: FakeEl;
  dec: FakeEl;
  inc: FakeEl;
  knock: FakeEl;
  gin: FakeEl;
}>;
const makeCard = (i: number): Card => {
  const dw = fakeEl(`dw${String(i)}`, { classes: ['dw'], value: '0' });
  const dec = fakeEl(`dec${String(i)}`, { classes: ['dec'] });
  const inc = fakeEl(`inc${String(i)}`, { classes: ['inc'] });
  const knock = fakeEl(`knock${String(i)}`, { classes: ['chip'], attrs: { 'data-k': 'knock' } });
  const gin = fakeEl(`gin${String(i)}`, { classes: ['chip'], attrs: { 'data-k': 'gin' } });
  const card = fakeEl(`card${String(i)}`, {
    classes: ['player-card'],
    queries: { '.dw': [dw], '.dec': [dec], '.inc': [inc], '.chip': [knock, gin] },
  });
  return { card, dw, dec, inc, knock, gin };
};

type Harness = Readonly<{
  page: GinPage;
  scorer: ReturnType<typeof createScorer>;
  log: unknown[][];
  storage: ReturnType<typeof fakeStorage>;
  /** The board cards handed out at the last render. */
  cards: () => ReadonlyArray<Card>;
  /** The history buttons handed out at the last render. */
  edits: () => ReadonlyArray<FakeEl>;
  dels: () => ReadonlyArray<FakeEl>;
  /** The remove button of each player row. */
  removes: ReadonlyArray<FakeEl>;
  answers: { prompt: (string | null)[]; confirm: boolean };
  recognizer: { last: SpeechRecognizerLike | null; startThrows: boolean };
  speech: 'supported' | 'none';
}>;

const harness = (
  options: Readonly<{
    playerRows?: number;
    names?: ReadonlyArray<string>;
    target?: string;
    speech?: 'supported' | 'none';
    stored?: Readonly<Record<string, string>>;
  }> = {},
): Harness => {
  const log: unknown[][] = [];
  const note =
    (name: string) =>
    (...args: unknown[]): void => {
      log.push([name, ...args]);
    };
  const storage = fakeStorage();
  Object.entries(options.stored ?? {}).forEach(([k, v]) => storage.map.set(k, v));
  const state = { cards: [] as Card[], edits: [] as FakeEl[], dels: [] as FakeEl[] };
  const playerCount = options.names?.length ?? 2;
  const removes = Array.from({ length: options.playerRows ?? playerCount }, (_, i) =>
    fakeEl(`rm${String(i)}`, { classes: ['remove-x'] }),
  );
  const rows = removes.map((rm, i) =>
    fakeEl(`row${String(i)}`, { classes: ['player-input-row'], queries: { '.remove-x': [rm] } }),
  );
  const inputs = (options.names ?? ['Ann', 'Bob']).map((name, i) =>
    fakeEl(`in${String(i)}`, { value: name }),
  );
  const page = ginPage(MARKUP, {
    scPlayers: {
      children: rows,
      queries: { '.player-input-row': rows, input: inputs },
    },
    scTargetInput: { value: options.target ?? '100' },
    scBoard: {
      queries: {
        '.player-card': () => {
          state.cards = Array.from({ length: playerCount }, (_, i) => makeCard(i));
          return state.cards.map((c) => c.card);
        },
      },
    },
    historyList: {
      queries: {
        '[data-edit]': () => {
          state.edits = [0, 1, 2].map((i) =>
            fakeEl(`edit${String(i)}`, { attrs: { 'data-edit': String(i) } }),
          );
          return state.edits;
        },
        '[data-del]': () => {
          state.dels = [0, 1, 2].map((i) =>
            fakeEl(`del${String(i)}`, { attrs: { 'data-del': String(i) } }),
          );
          return state.dels;
        },
      },
    },
  });
  const answers = { prompt: [] as (string | null)[], confirm: true };
  const recognizer = { last: null as SpeechRecognizerLike | null, startThrows: false };
  const speech = options.speech ?? 'supported';
  const clock = { t: NOW };
  const deps: ScorerDeps = {
    doc: page.doc,
    store: createStore(storage),
    now: () => {
      clock.t += 1000;
      return clock.t;
    },
    rng: mulberry32(9),
    fx: note('fx'),
    toast: note('toast'),
    dialogs: {
      prompt: (message, initial) => {
        log.push(['prompt', message, initial]);
        return answers.prompt.shift() ?? null;
      },
      confirm: (message) => {
        log.push(['confirm', message]);
        return answers.confirm;
      },
    },
    screens: {
      show: note('show'),
      initHome: note('initHome'),
      showScoreTab: note('showScoreTab'),
      openRules: note('openRules'),
      openHistory: note('openHistory'),
    },
    download: note('download'),
    speech:
      speech === 'none'
        ? null
        : () => {
            const rec: SpeechRecognizerLike = {
              lang: '',
              interimResults: true,
              maxAlternatives: 0,
              onresult: null,
              onerror: null,
              onend: null,
              start: () => {
                log.push(['speech.start']);
                if (recognizer.startThrows) throw new Error('busy');
              },
              stop: () => {
                log.push(['speech.stop']);
                throw new Error('already stopped');
              },
            };
            recognizer.last = rec;
            return rec;
          },
    formatTime: (ts) => `t${String(ts - NOW)}`,
    formatDateTime: (ts) => `d${String(ts - NOW)}`,
  };
  const scorer = createScorer(deps);
  scorer.bind();
  return {
    page,
    scorer,
    log,
    storage,
    cards: () => state.cards,
    edits: () => state.edits,
    dels: () => state.dels,
    removes,
    answers,
    recognizer,
    speech,
  };
};

const toasts = (h: Harness): ReadonlyArray<unknown> =>
  h.log.filter((e) => e[0] === 'toast').map((e) => e[1]);

/** Two players, started; Ann's card is `cards()[0]`. */
const started = (over: Parameters<typeof harness>[0] = {}): Harness => {
  const h = harness(over);
  h.page.get('scStartBtn').fire('click');
  return h;
};

describe('setup', () => {
  test('onShown seeds two rows the first time only; the stored names and the saved name win', () => {
    const h = harness({ playerRows: 0 });
    h.scorer.onShown();
    expect(h.page.get('scPlayers').text()).toBe(
      '<div class="player-input-row"><input type="text" placeholder="Player 1 name" value="Player 1" maxlength="20"><button class="remove-x" type="button">✕</button></div>' +
        '<div class="player-input-row"><input type="text" placeholder="Player 1 name" value="Player 2" maxlength="20"><button class="remove-x" type="button">✕</button></div>',
    );
    expect(h.page.get('scTargetInput').value()).toBe('100');
    const seeded = harness({
      playerRows: 0,
      stored: {
        [STORAGE_KEYS.scorerNames]: JSON.stringify(['Zed', 'Bob', 'Cy']),
        [STORAGE_KEYS.name]: 'Ann',
      },
    });
    seeded.scorer.onShown();
    expect(seeded.page.get('scPlayers').text()).toMatch(/value="Ann".*value="Bob".*value="Cy"/);
    const named = harness({ playerRows: 0, stored: { [STORAGE_KEYS.name]: 'Ann' } });
    named.scorer.onShown();
    expect(named.page.get('scPlayers').text()).toMatch(/value="Ann".*value="Player 2"/);
    // Rows already there: nothing is wiped.
    const busy = harness({ playerRows: 2 });
    busy.scorer.onShown();
    expect(busy.page.get('scPlayers').text()).toBe('');
  });

  test('a row is removed only while more than two remain; names are escaped', () => {
    const two = harness({ playerRows: 2 });
    two.page.get('scAddPlayerBtn').fire('click');
    expect(two.page.get('scPlayers').text()).toContain('placeholder="Player 3 name" value=""');
    two.removes[1]?.fire('click');
    expect(toasts(two)).toEqual([NEED_TWO_MSG]);
    expect(two.page.get('scPlayers').el.children).toHaveLength(2);
    const three = harness({ playerRows: 3 });
    three.page.get('scAddPlayerBtn').fire('click');
    three.removes[2]?.fire('click');
    expect(toasts(three)).toEqual([]);
    expect(toasts(three)).toEqual([]);
  });

  test('starting needs two names; it stores them, saves the session and opens the board', () => {
    const one = harness({ names: ['Ann', ''] });
    one.page.get('scStartBtn').fire('click');
    expect(toasts(one)).toEqual([ADD_TWO_MSG]);
    expect(one.scorer.state()).toBeNull();
    const h = started({ target: '75' });
    const s = h.scorer.state();
    expect(s).toMatchObject({ target: 75, rounds: [], startedAt: NOW + 1000 });
    expect(s?.players.map((p) => p.name)).toEqual(['Ann', 'Bob']);
    s?.players.forEach((p) => {
      expect(p.id).toMatch(/^[a-z0-9]{1,7}$/);
    });
    expect(h.storage.map.get(STORAGE_KEYS.scorerNames)).toBe('["Ann","Bob"]');
    expect(h.storage.map.get(STORAGE_KEYS.scorerState)).toBe(JSON.stringify(s));
    expect(h.log).toContainEqual(['show', 'scGameScreen']);
    expect(h.page.get('scRoundBadge').text()).toBe('Hand 1');
    expect(h.page.get('scTargetBadge').text()).toBe('to 75');
    expect(h.page.get('scBoard').text()).toContain('<div class="player-name">Ann</div>');
    expect(
      h.page
        .get('scBoard')
        .text()
        .match(/player-card/g),
    ).toHaveLength(2);
    expect(started({ target: 'abc' }).scorer.state()?.target).toBe(100);
  });
});

describe('the board', () => {
  test('the stepper, typing, focus and blur, and the chips write the entry and re-render', () => {
    const h = started();
    const ann = h.cards()[0];
    if (ann === undefined) throw new Error('no board');
    ann.inc.fire('click');
    expect(ann.dw.value()).toBe('1');
    ann.dec.fire('click');
    ann.dec.fire('click');
    expect(ann.dw.value()).toBe('0');
    (ann.dw.el as unknown as { value: string }).value = '12';
    ann.dw.fire('input');
    expect(ann.dw.value()).toBe('12');
    (ann.dw.el as unknown as { value: string }).value = 'abc';
    ann.dw.fire('input');
    expect(ann.dw.value()).toBe('0');
    ann.dw.fire('focus');
    expect(ann.dw.value()).toBe('');
    ann.dw.fire('blur');
    expect(ann.dw.value()).toBe('0');
    (ann.dw.el as unknown as { value: string }).value = '7';
    ann.dw.fire('input');
    ann.dw.fire('focus');
    expect(ann.dw.value()).toBe('7');
    ann.dw.fire('blur');
    expect(ann.dw.value()).toBe('7');
    // Knocked: the chip re-renders the board with the knock active.
    ann.knock.fire('click');
    expect(h.page.get('scBoard').text()).toContain('class="chip active" data-k="knock"');
    const bob = h.cards()[1];
    if (bob === undefined) throw new Error('no board');
    // Gin locks Bob's deadwood at 0 and disables his stepper.
    bob.gin.fire('click');
    const board = h.page.get('scBoard').text();
    expect(board).toContain('Deadwood — locked at 0 (Gin has no deadwood)');
    expect(board).toContain('class="dw" value="0" min="0" disabled');
    expect(board).toContain('class="chip active" data-k="gin"');
    expect(board).not.toContain('class="chip active" data-k="knock"');
    const bob2 = h.cards()[1];
    if (bob2 === undefined) throw new Error('no board');
    bob2.inc.fire('click');
    expect(bob2.dw.value()).toBe('0');
    // Tapping the active chip clears the knocker.
    bob2.gin.fire('click');
    expect(h.page.get('scBoard').text()).not.toContain('chip active');
  });

  test('a hand: submit needs a knocker; the result sheet, totals, leader and the saved round', () => {
    const h = started();
    h.page.get('scSubmitBtn').fire('click');
    expect(toasts(h)).toEqual([PICK_KNOCKER_MSG]);
    const [ann, bob] = h.cards();
    if (ann === undefined || bob === undefined) throw new Error('no board');
    ann.knock.fire('click');
    const [ann2, bob2] = h.cards();
    if (ann2 === undefined || bob2 === undefined) throw new Error('no board');
    (ann2.dw.el as unknown as { value: string }).value = '5';
    ann2.dw.fire('input');
    (bob2.dw.el as unknown as { value: string }).value = '20';
    bob2.dw.fire('input');
    h.page.get('scSubmitBtn').fire('click');
    const s = h.scorer.state();
    const [p1, p2] = s?.players ?? [];
    if (s === null || p1 === undefined || p2 === undefined) throw new Error('no state');
    expect(s.rounds).toEqual([
      {
        deadwood: { [p1.id]: 5, [p2.id]: 20 },
        knockerId: p1.id,
        knockType: 'knock',
        scores: { [p1.id]: 15, [p2.id]: 0 },
        ts: NOW + 2000,
      },
    ]);
    expect(h.log).toContainEqual(['fx', 'knockGood']);
    expect(h.page.get('scResOverlay').hidden()).toBe(false);
    expect(h.page.get('scResTitle').text()).toBe('Hand 1 results');
    expect(h.page.get('scResSub').text()).toBe('Ann — Knock (5 deadwood) · ⏱ 1s');
    expect(h.page.get('scResList').text()).toBe(
      '<div class="standing-row winner"><div class="standing-name">Ann <small style="color:var(--muted);font-weight:600">· 5 deadwood</small></div><div class="standing-total">+15</div></div>' +
        '<div class="standing-row "><div class="standing-name">Bob <small style="color:var(--muted);font-weight:600">· 20 deadwood</small></div><div class="standing-total">0</div></div>',
    );
    h.page.get('scResContinue').fire('click');
    expect(h.page.get('scResOverlay').hidden()).toBe(true);
    expect(h.page.get('scRoundBadge').text()).toBe('Hand 2');
    const board = h.page.get('scBoard').text();
    expect(board).toContain('<div class="player-card leader">');
    expect(board).toContain(
      '<div class="player-name">👑 Ann</div><div class="player-total">15</div>',
    );
    expect(board).toContain('<div class="player-name">Bob</div><div class="player-total">0</div>');
    expect(board).not.toContain('chip active');
    expect(h.storage.map.get(STORAGE_KEYS.scorerState)).toBe(JSON.stringify(h.scorer.state()));
    // Gin: the knocker's deadwood is forced to 0 and the gin cue plays; an undercut plays bad.
    const [a3, b3] = h.cards();
    if (a3 === undefined || b3 === undefined) throw new Error('no board');
    b3.gin.fire('click');
    const [a4] = h.cards();
    if (a4 === undefined) throw new Error('no board');
    (a4.dw.el as unknown as { value: string }).value = '10';
    a4.dw.fire('input');
    h.page.get('scSubmitBtn').fire('click');
    expect(h.scorer.state()?.rounds[1]).toMatchObject({
      knockType: 'gin',
      deadwood: { [p1.id]: 10, [p2.id]: 0 },
      scores: { [p1.id]: 0, [p2.id]: 35 },
    });
    expect(h.log).toContainEqual(['fx', 'gin']);
    expect(h.page.get('scResSub').text()).toBe('Bob — Gin · ⏱ 1s');
    h.page.get('scResContinue').fire('click');
    const [a5, b5] = h.cards();
    if (a5 === undefined || b5 === undefined) throw new Error('no board');
    a5.knock.fire('click');
    const [a6, b6] = h.cards();
    if (a6 === undefined || b6 === undefined) throw new Error('no board');
    (a6.dw.el as unknown as { value: string }).value = '9';
    a6.dw.fire('input');
    (b6.dw.el as unknown as { value: string }).value = '3';
    b6.dw.fire('input');
    h.page.get('scSubmitBtn').fire('click');
    expect(h.log).toContainEqual(['fx', 'bad']);
    expect(h.scorer.state()?.rounds[2]?.scores).toEqual({ [p1.id]: 0, [p2.id]: 31 });
  });

  test('reaching the target opens the end screen; keep playing and new game', () => {
    const h = started({ target: '10' });
    const [ann] = h.cards();
    if (ann === undefined) throw new Error('no board');
    ann.knock.fire('click');
    const [, bob] = h.cards();
    if (bob === undefined) throw new Error('no board');
    (bob.dw.el as unknown as { value: string }).value = '30';
    bob.dw.fire('input');
    h.page.get('scSubmitBtn').fire('click');
    h.page.get('scResContinue').fire('click');
    expect(h.log).toContainEqual(['show', 'scEndScreen']);
    expect(h.page.get('scEndTitle').text()).toBe('Ann wins! 🎉');
    expect(h.page.get('scEndSub').text()).toBe('Reached 30 points (target 10)');
    expect(h.page.get('scStandings').text()).toBe(
      '<div class="standing-row winner"><div class="standing-rank">#1</div><div class="standing-name">👑 Ann</div><div class="standing-total">30</div></div>' +
        '<div class="standing-row "><div class="standing-rank">#2</div><div class="standing-name">Bob</div><div class="standing-total">0</div></div>',
    );
    expect(h.page.get('scDuration').text()).toBe('1s · 1 hands');
    h.page.get('scEndKeepBtn').fire('click');
    expect(h.log.at(-1)).toEqual(['show', 'scGameScreen']);
    expect(h.page.get('scRoundBadge').text()).toBe('Hand 2');
    h.page.get('scEndNewBtn').fire('click');
    expect(h.scorer.state()).toBeNull();
    expect(h.storage.map.has(STORAGE_KEYS.scorerState)).toBe(false);
    expect(h.log.slice(-2)).toEqual([['show', 'homeScreen'], ['showScoreTab']]);
    expect(h.page.get('scPlayers').text()).toMatch(/value="Ann".*value="Bob"/);
  });
});

describe('history, export, voice and leaving', () => {
  const withHands = (): Harness => {
    const h = started();
    const [ann] = h.cards();
    if (ann === undefined) throw new Error('no board');
    ann.knock.fire('click');
    const [a2, b2] = h.cards();
    if (a2 === undefined || b2 === undefined) throw new Error('no board');
    (a2.dw.el as unknown as { value: string }).value = '5';
    a2.dw.fire('input');
    (b2.dw.el as unknown as { value: string }).value = '20';
    b2.dw.fire('input');
    h.page.get('scSubmitBtn').fire('click');
    h.page.get('scResContinue').fire('click');
    h.log.length = 0;
    return h;
  };

  test('the history lists the hands with edit and delete; delete asks first', () => {
    const empty = started();
    empty.page.get('scHistoryBtn').fire('click');
    expect(empty.page.get('historyList').text()).toBe(
      '<div class="empty-note">No hands yet.</div>',
    );
    expect(empty.log.at(-1)).toEqual(['openHistory']);
    const h = withHands();
    h.page.get('scEndHistoryBtn').fire('click');
    expect(h.page.get('historyList').text()).toBe(
      '<div class="history-round" style="display:flex;justify-content:space-between;align-items:center;gap:8px;"><div class="history-meta"><div class="history-scores"><strong>H1</strong> — Ann — Knock (5 dw)</div><div class="history-scores">Ann: +15 · Bob: 0</div><div class="history-time">t2000 · took 1s</div></div><div class="history-actions"><button type="button" data-edit="0">✎</button><button type="button" data-del="0">🗑</button></div></div><div id="historyTotalTime">⏱ Time played: 1s</div>',
    );
    h.answers.confirm = false;
    h.dels()[0]?.fire('click');
    expect(h.log).toContainEqual(['confirm', deleteHandMsg(0)]);
    expect(h.scorer.state()?.rounds).toHaveLength(1);
    h.answers.confirm = true;
    h.dels()[0]?.fire('click');
    expect(h.scorer.state()?.rounds).toHaveLength(0);
    expect(h.page.get('historyList').text()).toBe('<div class="empty-note">No hands yet.</div>');
    expect(h.page.get('scRoundBadge').text()).toBe('Hand 1');
  });

  test('editing a hand through the prompt() dialogs (the named legacy debt)', () => {
    const h = withHands();
    h.page.get('scHistoryBtn').fire('click');
    const s = h.scorer.state();
    const [p1, p2] = s?.players ?? [];
    if (p1 === undefined || p2 === undefined) throw new Error('no state');
    // Cancelled at the first prompt: nothing changes.
    h.answers.prompt = [null];
    h.edits()[0]?.fire('click');
    expect(h.log.at(-1)).toEqual([
      'prompt',
      'Hand 1: who knocked or went gin? (player name)',
      'Ann',
    ]);
    // An unknown name.
    h.answers.prompt = ['Zed'];
    h.edits()[0]?.fire('click');
    expect(toasts(h)).toEqual([NO_SUCH_PLAYER_MSG]);
    // Cancelled at the type, then at a deadwood: still unchanged.
    h.answers.prompt = [' bob ', null];
    h.edits()[0]?.fire('click');
    h.answers.prompt = ['Bob', 'knock', null];
    h.edits()[0]?.fire('click');
    expect(h.scorer.state()?.rounds[0]).toMatchObject({ knockerId: p1.id, knockType: 'knock' });
    // Bob went gin: his deadwood is 0 without asking; Ann's is asked, junk keeps the old value.
    h.answers.prompt = ['Bob', 'GIN', 'abc'];
    h.edits()[0]?.fire('click');
    expect(h.log.filter((e) => e[0] === 'prompt').slice(-3)).toEqual([
      ['prompt', 'Hand 1: who knocked or went gin? (player name)', 'Ann'],
      ['prompt', 'Type for Bob: knock or gin', 'knock'],
      ['prompt', 'Deadwood for Ann:', '5'],
    ]);
    expect(h.scorer.state()?.rounds[0]).toMatchObject({
      knockerId: p2.id,
      knockType: 'gin',
      deadwood: { [p1.id]: 5, [p2.id]: 0 },
      scores: { [p1.id]: 0, [p2.id]: 30 },
    });
    expect(h.page.get('historyList').text()).toContain('<strong>H1</strong> — Bob — Gin</div>');
    expect(h.page.get('scBoard').text()).toContain(
      '👑 Bob</div><div class="player-total">30</div>',
    );
    // A knock with a negative count is clamped to 0.
    h.answers.prompt = ['Ann', 'knock', '-3', '8'];
    h.edits()[0]?.fire('click');
    expect(h.scorer.state()?.rounds[0]).toMatchObject({
      deadwood: { [p1.id]: 0, [p2.id]: 8 },
      scores: { [p1.id]: 8, [p2.id]: 0 },
    });
    expect(h.storage.map.get(STORAGE_KEYS.scorerState)).toBe(JSON.stringify(h.scorer.state()));
    // An edit that reaches the target opens the end screen.
    h.answers.prompt = ['Ann', 'knock', '0', '200'];
    h.edits()[0]?.fire('click');
    expect(h.log.at(-1)).toEqual(['show', 'scEndScreen']);
  });

  test('export needs a hand; then the CSV goes to the download with the legacy file name', () => {
    const empty = started();
    empty.page.get('scExportBtn').fire('click');
    expect(toasts(empty)).toEqual([NOTHING_TO_EXPORT_MSG]);
    const h = withHands();
    h.page.get('scEndExportBtn').fire('click');
    const download = h.log.find((e) => e[0] === 'download');
    expect(download?.[1]).toMatch(/^gin-rummy-Ann-vs-Bob-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.csv$/);
    expect(download?.[2]).toBe(
      [
        'Hand,Time,Duration,Knocker,Type,Ann Deadwood,Bob Deadwood,Ann Score,Bob Score',
        '1,d2000,1s,Ann,Knock,5,20,15,0',
        '',
        'TOTAL,,,,,,,15,0',
      ].join('\r\n'),
    );
    expect(toasts(h)).toEqual([EXPORTED_MSG]);
  });

  test('voice entry fills the board from the transcript; errors and unsupported browsers toast', () => {
    const none = started({ speech: 'none' });
    none.page.get('scVoiceBtn').fire('click');
    expect(toasts(none)).toEqual([NO_VOICE_MSG]);
    const h = started();
    h.page.get('scVoiceBtn').fire('click');
    const rec = h.recognizer.last;
    if (rec === null) throw new Error('no recogniser');
    expect(rec).toMatchObject({ lang: 'en-US', interimResults: false, maxAlternatives: 1 });
    expect(h.page.get('scVoiceBtn').hasClass('listening')).toBe(true);
    expect(toasts(h)).toEqual([LISTENING_MSG]);
    expect(h.log).toContainEqual(['speech.start']);
    rec.onresult?.({ results: [[{ transcript: 'Ann knocked with five, Bob twenty' }]] });
    expect(toasts(h).at(-1)).toBe(heardMsg(['Ann: Knock (5)', 'Bob: 20']));
    const board = h.page.get('scBoard').text();
    expect(board).toContain('class="dw" value="5"');
    expect(board).toContain('class="dw" value="20"');
    expect(board).toContain('class="chip active" data-k="knock"');
    rec.onresult?.({ results: [[{ transcript: 'Bob gin' }]] });
    expect(h.page.get('scBoard').text()).toContain('class="chip active" data-k="gin"');
    rec.onresult?.({ results: [[{ transcript: 'mumble' }]] });
    expect(toasts(h).at(-1)).toBe(notHeardMsg('mumble'));
    rec.onresult?.({ results: [] });
    expect(toasts(h).at(-1)).toBe(notHeardMsg(''));
    rec.onerror?.({ error: 'no-speech' });
    rec.onerror?.({ error: 'not-allowed' });
    rec.onerror?.({ error: 'service-not-allowed' });
    rec.onerror?.({ error: 'network' });
    expect(toasts(h).slice(-4)).toEqual([
      NO_SPEECH_MSG,
      MIC_BLOCKED_MSG,
      MIC_BLOCKED_MSG,
      'Voice input error: network',
    ]);
    rec.onend?.();
    expect(h.page.get('scVoiceBtn').hasClass('listening')).toBe(false);
    // A second tap stops the first recogniser (even if stopping throws) and starts another.
    h.recognizer.startThrows = true;
    h.page.get('scVoiceBtn').fire('click');
    expect(h.log).toContainEqual(['speech.stop']);
    expect(toasts(h).at(-1)).toBe(VOICE_START_FAILED_MSG);
    expect(h.page.get('scVoiceBtn').hasClass('listening')).toBe(false);
  });

  test('leaving asks, then clears the session and goes home; resume reopens the board or the end', () => {
    const h = withHands();
    h.answers.confirm = false;
    h.page.get('scLeaveBtn').fire('click');
    expect(h.log).toEqual([['confirm', LEAVE_MSG]]);
    expect(h.scorer.state()).not.toBeNull();
    h.answers.confirm = true;
    h.page.get('scLeaveBtn').fire('click');
    expect(h.scorer.state()).toBeNull();
    expect(h.storage.map.has(STORAGE_KEYS.scorerState)).toBe(false);
    expect(h.log.at(-1)).toEqual(['initHome']);
    // Resume from storage.
    const fresh = harness();
    expect(fresh.scorer.saved()).toBeNull();
    fresh.scorer.resume();
    expect(fresh.log).toEqual([]);
    const saved: ScorerState = {
      players: [
        { id: 'a', name: 'Ann' },
        { id: 'b', name: 'Bob' },
      ],
      target: 20,
      rounds: [
        {
          deadwood: { a: 5, b: 20 },
          knockerId: 'a',
          knockType: 'knock',
          scores: { a: 15, b: 0 },
          ts: NOW,
        },
      ],
      startedAt: NOW - 5000,
    };
    const resumed = harness({ stored: { [STORAGE_KEYS.scorerState]: JSON.stringify(saved) } });
    expect(resumed.scorer.saved()).toEqual(saved);
    resumed.scorer.resume();
    expect(resumed.log.at(-1)).toEqual(['show', 'scGameScreen']);
    expect(resumed.page.get('scRoundBadge').text()).toBe('Hand 2');
    const finished = harness({
      stored: { [STORAGE_KEYS.scorerState]: JSON.stringify({ ...saved, target: 10 }) },
    });
    finished.scorer.resume();
    expect(finished.log.at(-1)).toEqual(['show', 'scEndScreen']);
    expect(finished.page.get('scDuration').text()).toBe('5s · 1 hands');
    finished.page.get('scRulesBtn2').fire('click');
    expect(finished.log.at(-1)).toEqual(['openRules']);
  });
});

describe('the markup helpers', () => {
  const players = [
    { id: 'a', name: 'A & B' },
    { id: 'b', name: 'Bob' },
  ];
  const state: ScorerState = {
    players,
    target: 100,
    rounds: [
      {
        deadwood: { a: 0, b: 12 },
        knockerId: 'a',
        knockType: 'gin',
        scores: { a: 37, b: 0 },
        ts: NOW,
      },
      {
        deadwood: { a: 4, b: 9 },
        knockerId: 'zed',
        knockType: 'knock',
        scores: { a: 0, b: 0 },
        ts: NOW + 60_000,
      },
    ],
    startedAt: NOW - 3000,
  };

  test('escape names, mark leaders, and tolerate a knocker who is no longer a player', () => {
    expect(
      playerCardHtml(players[0] ?? { id: 'a', name: '' }, 3, true, {
        deadwood: { a: 2 },
        knockerId: null,
        knockType: null,
      }).markup,
    ).toContain('<div class="player-name">👑 A &amp; B</div><div class="player-total">3</div>');
    const first = state.rounds[0];
    if (first === undefined) throw new Error('no rounds');
    expect(resultRowsHtml(state, first).markup).toContain('A &amp; B <small');
    expect(standingsHtml([{ player: { id: 'b', name: 'Bob' }, total: 5 }]).markup).toBe(
      '<div class="standing-row winner"><div class="standing-rank">#1</div><div class="standing-name">👑 Bob</div><div class="standing-total">5</div></div>',
    );
    const history = scorerHistoryHtml(state, (ts) => String(ts)).markup;
    expect(history).toContain('<strong>H1</strong> — A &amp; B — Gin</div>');
    expect(history).toContain('<strong>H2</strong> — </div>');
    expect(history).toContain('<div class="history-scores">A &amp; B: +37 · Bob: 0</div>');
    expect(history).toContain('· took 1m 0s</div>');
    expect(history).toContain('<div id="historyTotalTime">⏱ Time played: 1m 3s</div>');
    expect(durationText(state)).toBe('1m 3s · 2 hands');
    expect(durationText({ ...state, rounds: [] })).toBe('—');
    expect(scorerHistoryHtml(null, String).markup).toBe(
      '<div class="empty-note">No hands yet.</div>',
    );
  });
});
