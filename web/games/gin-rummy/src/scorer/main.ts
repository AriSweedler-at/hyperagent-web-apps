// The Score Counter's screens (docs/MIGRATION.md step 12; docs/ARCHITECTURE.md "Module
// boundaries": `scorer/main.ts` is the screen, an edge, over the pure scorer/{scores,voice,csv,
// format}.ts). The legacy scorer IIFE (legacy/gin-rummy/index.html) kept score for a game played
// with real cards, any number of players (two now: the pass-and-play players, whose names the home
// screen owns), in a module-level `state` and a `cur` entry, and wrote
// its screens directly; this is that IIFE with its state in a closure, its DOM writes through
// @shared/edge/dom, and everything it reached for by injection: storage, the clock, the rng for
// player ids, the sound cues, the toast, the dialogs, the app's screens (the legacy called
// `window.__gin`), the CSV download and SpeechRecognition. `createScorer` returns what the legacy
// exposed as `window.__scorer` (`saved`, `resume`) plus `bind`.
//
// KNOWN LEGACY DEBT, preserved until docs/MIGRATION.md step 15: editing a hand from the history
// goes through `prompt()` dialogs and deleting one through `confirm()`, as the legacy did.
import {
  addClass,
  listen,
  listenId,
  queryAllIn,
  queryIn,
  readValue,
  removeClass,
  requireId,
  safeHtml,
  selectText,
  setHtml,
  setText,
  setValue,
  toggleClass,
  trustedHtml,
  type PageLike,
  type SafeHtml,
} from '../../../../shared/edge/dom.ts';
import type { Rng } from '../../../../shared/lib/rng.ts';
import { readScorerState, writeScorerState, type Store } from '../storage.ts';
import { csvFileName, exportCsv } from './csv.ts';
import { fmtDuration } from './format.ts';
import {
  KNOCK_LABELS,
  computeRoundScores,
  ranked,
  totalFor,
  winnerOf,
  type ByPlayer,
  type KnockType,
  type ScorerPlayer,
  type ScorerRound,
  type ScorerState,
  type Standing,
} from './scores.ts';
import { parseVoiceScores } from './voice.ts';

export type ScorerScreen = 'homeScreen' | 'scGameScreen' | 'scEndScreen';

/** The members of SpeechRecognition the legacy used, structurally: a browser object whose handlers are assigned. */
// eslint-disable-next-line functional/type-declaration-immutability -- the recogniser's handlers and options are set by assignment, as the API is designed
export type SpeechRecognizerLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult:
    | ((
        e: Readonly<{ results: ReadonlyArray<ReadonlyArray<Readonly<{ transcript: string }>>> }>,
      ) => void)
    | null;
  onerror: ((e: Readonly<{ error: string }>) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

export type ScorerDeps = Readonly<{
  doc: PageLike;
  store: Store;
  now: () => number;
  /** Player ids are `rng().toString(36).slice(2, 9)`, as the legacy `uid()` drew them. */
  rng: Rng;
  fx: (cue: 'gin' | 'knockGood' | 'bad') => void;
  toast: (message: string) => void;
  dialogs: Readonly<{
    prompt: (message: string, initial: string) => string | null;
    confirm: (message: string) => boolean;
  }>;
  /** What the legacy called on `window.__gin` and wrote to the shared overlays. */
  screens: Readonly<{
    show: (screen: ScorerScreen) => void;
    initHome: () => void;
    showScoreTab: () => void;
    openRules: () => void;
    openHistory: () => void;
  }>;
  download: (fileName: string, csv: string) => void;
  /** A SpeechRecognition factory, or null where the browser has none. */
  speech: (() => SpeechRecognizerLike) | null;
  /** `new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })`. */
  formatTime: (ts: number) => string;
  /** `new Date(ts).toLocaleString()`, the CSV's time column. */
  formatDateTime: (ts: number) => string;
}>;

export type Scorer = Readonly<{
  /** `loadSaved()`: the session under `ginRummyScorerState_v2`, or null. */
  saved: () => ScorerState | null;
  /** The resume box: back to the board, or the end screen when the target was reached. */
  resume: () => void;
  /** Register every control's handler, once, at boot. */
  bind: () => void;
  /** The current session (tests). */
  state: () => ScorerState | null;
}>;

/** What the board collects for the hand in progress. */
type Entry = Readonly<{
  deadwood: ByPlayer;
  knockerId: string | null;
  knockType: KnockType | null;
}>;

export const PICK_KNOCKER_MSG = 'Select who Knocked or went Gin first.';
export const NOTHING_TO_EXPORT_MSG = 'No hands scored yet — nothing to export.';
export const EXPORTED_MSG = 'Exported the game as a CSV file.';
export const NO_VOICE_MSG = "Voice input isn't supported in this browser.";
export const LISTENING_MSG = 'Listening… say e.g. "Ari knocked with five, Jeff twenty"';
export const NO_SPEECH_MSG = "Didn't hear anything — try again.";
export const MIC_BLOCKED_MSG = 'Microphone access was blocked.';
export const VOICE_START_FAILED_MSG = 'Could not start voice input.';
export const NO_SUCH_PLAYER_MSG = 'No player with that name.';
export const LEAVE_MSG = 'End this scoring session? Scores will be cleared.';
export const notHeardMsg = (transcript: string): string =>
  `Didn't catch that — heard: "${transcript}"`;
export const heardMsg = (matches: ReadonlyArray<string>): string => `Heard: ${matches.join(' · ')}`;
export const deleteHandMsg = (index: number): string => `Delete hand ${String(index + 1)}?`;

const DEFAULT_TARGET = 100;

const emptyEntry = (players: ReadonlyArray<ScorerPlayer>): Entry => ({
  deadwood: Object.fromEntries(players.map((p) => [p.id, 0])),
  knockerId: null,
  knockType: null,
});

/** `parseInt(v, 10)`, 100 unless a positive integer. */
const parseTarget = (raw: string): number => {
  const t = parseInt(raw, 10);
  return !Number.isNaN(t) && t > 0 ? t : DEFAULT_TARGET;
};

const prevTsOf = (state: ScorerState, index: number): number =>
  index > 0 ? (state.rounds[index - 1]?.ts ?? state.startedAt) : state.startedAt;

/** `${name} — Knock (5 deadwood)` / `${name} — Gin`, or '' for a knocker who is no longer a player. */
const knockDesc = (
  state: ScorerState,
  r: ScorerRound,
  countWord: 'deadwood' | 'dw',
): SafeHtml | null => {
  const k = state.players.find((p) => p.id === r.knockerId);
  if (k === undefined) return null;
  const count = r.knockType === 'knock' ? ` (${String(r.deadwood[k.id] ?? 0)} ${countWord})` : '';
  return safeHtml`${k.name} — ${KNOCK_LABELS[r.knockType]}${count}`;
};

/** `${name}: +12 · ${name}: 0`, every player. */
const pointsLine = (state: ScorerState, r: ScorerRound): SafeHtml =>
  safeHtml`${state.players.map((p, i) => {
    const pts = r.scores[p.id] ?? 0;
    return safeHtml`${i > 0 ? ' · ' : ''}${p.name}: ${pts > 0 ? '+' : ''}${pts}`;
  })}`;

// ---- markup ----------------------------------------------------------------------------------------

/** One board card, the legacy template line for line; `leader` crowns the sole leader. */
export const playerCardHtml = (
  p: ScorerPlayer,
  total: number,
  isLeader: boolean,
  cur: Entry,
): SafeHtml => {
  const ginLocked = cur.knockerId === p.id && cur.knockType === 'gin';
  const dw = ginLocked ? 0 : (cur.deadwood[p.id] ?? 0);
  const off = trustedHtml(ginLocked ? 'disabled' : '');
  const knockActive = cur.knockerId === p.id && cur.knockType === 'knock' ? 'active' : '';
  return safeHtml`<div class="player-card${isLeader ? ' leader' : ''}">
        <div class="player-head"><div class="player-name">${isLeader ? '👑 ' : ''}${p.name}</div><div class="player-total">${total}</div></div>
        <label style="display:block; margin-bottom:6px;">Deadwood${ginLocked ? ' — locked at 0 (Gin has no deadwood)' : ''}</label>
        <div class="stepper">
          <button type="button" class="dec" ${off}>−</button>
          <input type="number" inputmode="numeric" class="dw" value="${dw}" min="0" ${off}>
          <button type="button" class="inc" ${off}>+</button>
        </div>
        <div class="bonus-row">
          <button type="button" class="chip ${knockActive}" data-k="knock">Knocked</button>
          <button type="button" class="chip ${ginLocked ? 'active' : ''}" data-k="gin">Gin</button>
        </div></div>`;
};

/** `#scResList`: players by points for the hand, the scorers marked. */
export const resultRowsHtml = (state: ScorerState, round: ScorerRound): SafeHtml => {
  type Row = Readonly<{ p: ScorerPlayer; pts: number; dw: number }>;
  const rows = [
    ...state.players.map((p): Row => ({
      p,
      pts: round.scores[p.id] ?? 0,
      dw: round.deadwood[p.id] ?? 0,
    })),
  ].sort((a: Row, b: Row) => b.pts - a.pts);
  return safeHtml`${rows.map(
    (e) =>
      safeHtml`<div class="standing-row ${e.pts > 0 ? 'winner' : ''}"><div class="standing-name">${e.p.name} <small style="color:var(--muted);font-weight:600">· ${e.dw} deadwood</small></div><div class="standing-total">${e.pts > 0 ? '+' : ''}${e.pts}</div></div>`,
  )}`;
};

/** `#scStandings`: the final ranking, the winner crowned. */
export const standingsHtml = (standings: ReadonlyArray<Standing>): SafeHtml =>
  safeHtml`${standings.map(
    (x, i) =>
      safeHtml`<div class="standing-row ${i === 0 ? 'winner' : ''}"><div class="standing-rank">#${i + 1}</div><div class="standing-name">${i === 0 ? '👑 ' : ''}${x.player.name}</div><div class="standing-total">${x.total}</div></div>`,
  )}`;

/** `#historyList` for the scorer: every hand with its edit and delete buttons, then the time played. */
export const scorerHistoryHtml = (
  state: ScorerState | null,
  formatTime: (ts: number) => string,
): SafeHtml => {
  if (state === null || state.rounds.length === 0)
    return trustedHtml('<div class="empty-note">No hands yet.</div>');
  const rows = state.rounds.map((r, idx) => {
    const desc = knockDesc(state, r, 'dw') ?? trustedHtml('');
    const dur = fmtDuration(r.ts - prevTsOf(state, idx));
    return safeHtml`<div class="history-round" style="display:flex;justify-content:space-between;align-items:center;gap:8px;"><div class="history-meta"><div class="history-scores"><strong>H${idx + 1}</strong> — ${desc}</div><div class="history-scores">${pointsLine(state, r)}</div><div class="history-time">${formatTime(r.ts)} · took ${dur}</div></div><div class="history-actions"><button type="button" data-edit="${idx}">✎</button><button type="button" data-del="${idx}">🗑</button></div></div>`;
  });
  const last = state.rounds[state.rounds.length - 1];
  const total = fmtDuration((last?.ts ?? state.startedAt) - state.startedAt);
  return safeHtml`${rows}<div id="historyTotalTime">⏱ Time played: ${total}</div>`;
};

/** `#scResSub`: who knocked and how, and the hand's duration. */
export const resultSubText = (state: ScorerState, round: ScorerRound): string => {
  const idx = state.rounds.length - 1;
  const roundDur = fmtDuration(round.ts - prevTsOf(state, idx));
  const k = state.players.find((p) => p.id === round.knockerId);
  const who =
    k === undefined
      ? ''
      : `${k.name} — ${KNOCK_LABELS[round.knockType]}${round.knockType === 'knock' ? ` (${String(round.deadwood[k.id] ?? 0)} deadwood)` : ''}`;
  return `${who} · ⏱ ${roundDur}`;
};

/** `#scDuration`: the time to the last hand and the hand count, or a dash. */
export const durationText = (state: ScorerState): string => {
  const last = state.rounds[state.rounds.length - 1];
  return last === undefined
    ? '—'
    : `${fmtDuration(last.ts - state.startedAt)} · ${String(state.rounds.length)} hands`;
};

// ---- the screen --------------------------------------------------------------------------------------

export const createScorer = (deps: ScorerDeps): Scorer => {
  const { doc, store, toast, screens } = deps;
  let state: ScorerState | null = null;
  let cur: Entry = emptyEntry([]);
  let recognizer: SpeechRecognizerLike | null = null;

  const uid = (): string => deps.rng().toString(36).slice(2, 9);
  const save = (): void => {
    writeScorerState(store, state);
  };
  const loadSaved = (): ScorerState | null => {
    const read = readScorerState(store);
    return read.ok ? read.value : null;
  };
  const resetCur = (players: ReadonlyArray<ScorerPlayer>): void => {
    cur = emptyEntry(players);
  };

  // ---- setup ----
  // The two players are pass-and-play's two names: `#scP1NameInput` and `#scP2NameInput` are
  // filled by `home/init` and by every keystroke in any name input (ui/home.ts), so this module
  // never seeds them. Only the target is reset for a fresh setup.
  const resetTarget = (): void => {
    setValue(requireId(doc, 'scTargetInput'), '100');
  };

  const openFreshSetup = (): void => {
    screens.show('homeScreen');
    screens.showScoreTab();
    resetTarget();
  };

  // ---- the board ----
  const renderBoard = (): void => {
    if (state === null) return;
    const s = state;
    setText(requireId(doc, 'scRoundBadge'), `Hand ${String(s.rounds.length + 1)}`);
    setText(requireId(doc, 'scTargetBadge'), `to ${String(s.target)}`);
    const totals = s.players.map((p) => totalFor(s.rounds, p.id));
    const max = Math.max(...totals);
    const leaders = totals.filter((t) => t === max).length;
    const board = requireId(doc, 'scBoard');
    setHtml(
      board,
      safeHtml`${s.players.map((p, i) =>
        playerCardHtml(
          p,
          totals[i] ?? 0,
          s.rounds.length > 0 && totals[i] === max && leaders === 1,
          cur,
        ),
      )}`,
    );
    queryAllIn(board, '.player-card').forEach((card, i) => {
      const p = s.players[i];
      if (p === undefined) return;
      const ginLocked = cur.knockerId === p.id && cur.knockType === 'gin';
      const input = queryIn(card, '.dw');
      if (input === null) return;
      const set = (v: number): void => {
        if (ginLocked) return;
        const n = Math.max(0, Number.isNaN(v) ? 0 : v);
        cur = { ...cur, deadwood: { ...cur.deadwood, [p.id]: n } };
        setValue(input, String(n));
      };
      const current = (): number => cur.deadwood[p.id] ?? 0;
      listen(input, 'focus', () => {
        if (readValue(input) === '0') setValue(input, '');
        selectText(input);
      });
      listen(input, 'blur', () => {
        if (readValue(input).trim() === '') setValue(input, String(current()));
      });
      listen(input, 'input', () => {
        set(parseInt(readValue(input), 10));
      });
      const dec = queryIn(card, '.dec');
      if (dec !== null)
        listen(dec, 'click', () => {
          set(current() - 1);
        });
      const inc = queryIn(card, '.inc');
      if (inc !== null)
        listen(inc, 'click', () => {
          set(current() + 1);
        });
      queryAllIn(card, '.chip').forEach((chip) => {
        const k: KnockType = chip.getAttribute('data-k') === 'gin' ? 'gin' : 'knock';
        listen(chip, 'click', () => {
          if (cur.knockerId === p.id && cur.knockType === k) {
            cur = { ...cur, knockerId: null, knockType: null };
          } else {
            cur = {
              deadwood: k === 'gin' ? { ...cur.deadwood, [p.id]: 0 } : cur.deadwood,
              knockerId: p.id,
              knockType: k,
            };
          }
          renderBoard();
        });
      });
    });
  };

  const openGame = (): void => {
    screens.show('scGameScreen');
    renderBoard();
  };

  const openEnd = (standings: ReadonlyArray<Standing>): void => {
    if (state === null) return;
    const w = standings[0];
    if (w === undefined) return;
    screens.show('scEndScreen');
    setText(requireId(doc, 'scEndTitle'), `${w.player.name} wins! 🎉`);
    setText(
      requireId(doc, 'scEndSub'),
      `Reached ${String(w.total)} points (target ${String(state.target)})`,
    );
    setHtml(requireId(doc, 'scStandings'), standingsHtml(standings));
    setText(requireId(doc, 'scDuration'), durationText(state));
  };

  const checkWinner = (): void => {
    if (state !== null && winnerOf(state) !== null) openEnd(ranked(state));
  };

  /** `(value.trim() || fallback)`: the same fallbacks as pass-and-play's Start. */
  const nameOr = (id: string, fallback: string): string => {
    const trimmed = readValue(requireId(doc, id)).trim();
    return trimmed === '' ? fallback : trimmed;
  };

  const startScoring = (): void => {
    const names = [nameOr('scP1NameInput', 'Player 1'), nameOr('scP2NameInput', 'Player 2')];
    const players = names.map((n) => ({ id: uid(), name: n }));
    state = {
      players,
      target: parseTarget(readValue(requireId(doc, 'scTargetInput'))),
      rounds: [],
      startedAt: deps.now(),
    };
    save();
    resetCur(players);
    openGame();
  };

  // ---- a hand ----
  const showResult = (round: ScorerRound): void => {
    if (state === null) return;
    setText(requireId(doc, 'scResTitle'), `Hand ${String(state.rounds.length)} results`);
    setText(requireId(doc, 'scResSub'), resultSubText(state, round));
    setHtml(requireId(doc, 'scResList'), resultRowsHtml(state, round));
    toggleClass(requireId(doc, 'scResOverlay'), 'hidden', false);
  };

  const submitRound = (): void => {
    if (state === null) return;
    if (cur.knockerId === null || cur.knockType === null) {
      toast(PICK_KNOCKER_MSG);
      return;
    }
    const knockerId = cur.knockerId;
    const knockType = cur.knockType;
    const deadwood: ByPlayer =
      knockType === 'gin' ? { ...cur.deadwood, [knockerId]: 0 } : { ...cur.deadwood };
    const scores = computeRoundScores(state.players, { deadwood, knockerId, knockType });
    const round: ScorerRound = { deadwood, knockerId, knockType, scores, ts: deps.now() };
    state = { ...state, rounds: [...state.rounds, round] };
    save();
    deps.fx(knockType === 'gin' ? 'gin' : (scores[knockerId] ?? 0) > 0 ? 'knockGood' : 'bad');
    showResult(round);
  };

  const afterResult = (): void => {
    toggleClass(requireId(doc, 'scResOverlay'), 'hidden', true);
    if (state !== null) resetCur(state.players);
    renderBoard();
    checkWinner();
  };

  // ---- history ----
  /**
   * The deadwood for every player through `prompt()` (the legacy loop); null when the player
   * cancelled any of them, and then nothing is changed.
   */
  const askDeadwood = (
    s: ScorerState,
    r: ScorerRound,
    knocker: ScorerPlayer,
    knockType: KnockType,
    index: number,
    acc: ByPlayer,
  ): ByPlayer | null => {
    const p = s.players[index];
    if (p === undefined) return acc;
    const previous = r.deadwood[p.id] ?? 0;
    if (knockType === 'gin' && p.id === knocker.id)
      return askDeadwood(s, r, knocker, knockType, index + 1, { ...acc, [p.id]: 0 });
    const v = deps.dialogs.prompt(`Deadwood for ${p.name}:`, String(previous));
    if (v === null) return null;
    const n = parseInt(v, 10);
    return askDeadwood(s, r, knocker, knockType, index + 1, {
      ...acc,
      [p.id]: Number.isNaN(n) ? previous : Math.max(0, n),
    });
  };

  const editRound = (idx: number): void => {
    if (state === null) return;
    const s = state;
    const r = s.rounds[idx];
    if (r === undefined) return;
    const curName = (s.players.find((p) => p.id === r.knockerId) ?? s.players[0])?.name ?? '';
    const who = deps.dialogs.prompt(
      `Hand ${String(idx + 1)}: who knocked or went gin? (player name)`,
      curName,
    );
    if (who === null) return;
    const kp = s.players.find((p) => p.name.toLowerCase() === who.trim().toLowerCase());
    if (kp === undefined) {
      toast(NO_SUCH_PLAYER_MSG);
      return;
    }
    const type = deps.dialogs.prompt(`Type for ${kp.name}: knock or gin`, r.knockType);
    if (type === null) return;
    const knockType: KnockType = type.trim().toLowerCase() === 'gin' ? 'gin' : 'knock';
    const deadwood = askDeadwood(s, r, kp, knockType, 0, {});
    if (deadwood === null) return;
    const edited: ScorerRound = {
      ...r,
      deadwood,
      knockerId: kp.id,
      knockType,
      scores: computeRoundScores(s.players, { deadwood, knockerId: kp.id, knockType }),
    };
    state = { ...s, rounds: s.rounds.map((x, i) => (i === idx ? edited : x)) };
    save();
    renderBoard();
    renderHistory();
    checkWinner();
  };

  const deleteRound = (idx: number): void => {
    if (state === null || !deps.dialogs.confirm(deleteHandMsg(idx))) return;
    state = { ...state, rounds: state.rounds.filter((_, i) => i !== idx) };
    save();
    renderBoard();
    renderHistory();
  };

  const renderHistory = (): void => {
    const list = requireId(doc, 'historyList');
    setHtml(list, scorerHistoryHtml(state, deps.formatTime));
    queryAllIn(list, '[data-edit]').forEach((b) => {
      listen(b, 'click', () => {
        editRound(Number(b.getAttribute('data-edit')));
      });
    });
    queryAllIn(list, '[data-del]').forEach((b) => {
      listen(b, 'click', () => {
        deleteRound(Number(b.getAttribute('data-del')));
      });
    });
  };

  const openHistory = (): void => {
    renderHistory();
    screens.openHistory();
  };

  // ---- export ----
  const exportGame = (): void => {
    if (state === null || state.rounds.length === 0) {
      toast(NOTHING_TO_EXPORT_MSG);
      return;
    }
    deps.download(csvFileName(state.players, deps.now()), exportCsv(state, deps.formatDateTime));
    toast(EXPORTED_MSG);
  };

  // ---- voice entry ----
  const applyVoiceResult = (transcript: string): void => {
    if (state === null) return;
    const { heard, matches } = parseVoiceScores(transcript, state.players);
    if (matches.length === 0) {
      toast(notHeardMsg(transcript));
      return;
    }
    const deadwood = { ...cur.deadwood, ...heard.deadwood };
    cur =
      heard.knockerId !== null
        ? {
            deadwood: heard.knockType === 'gin' ? { ...deadwood, [heard.knockerId]: 0 } : deadwood,
            knockerId: heard.knockerId,
            knockType: heard.knockType,
          }
        : { ...cur, deadwood };
    renderBoard();
    toast(heardMsg(matches));
  };

  const startVoiceEntry = (): void => {
    if (deps.speech === null) {
      toast(NO_VOICE_MSG);
      return;
    }
    try {
      recognizer?.stop();
    } catch {
      /* a recogniser that was already stopped */
    }
    const rec = deps.speech();
    recognizer = rec;
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    const btn = requireId(doc, 'scVoiceBtn');
    addClass(btn, 'listening');
    toast(LISTENING_MSG);
    rec.onresult = (e) => {
      const transcript = e.results[0]?.[0]?.transcript ?? '';
      applyVoiceResult(transcript);
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech') toast(NO_SPEECH_MSG);
      else if (e.error === 'not-allowed' || e.error === 'service-not-allowed')
        toast(MIC_BLOCKED_MSG);
      else toast(`Voice input error: ${e.error}`);
    };
    rec.onend = () => {
      removeClass(btn, 'listening');
    };
    try {
      rec.start();
    } catch {
      removeClass(btn, 'listening');
      toast(VOICE_START_FAILED_MSG);
    }
  };

  const leave = (): void => {
    if (!deps.dialogs.confirm(LEAVE_MSG)) return;
    state = null;
    save();
    screens.initHome();
  };

  const bind = (): void => {
    listenId(doc, 'scStartBtn', 'click', startScoring);
    listenId(doc, 'scSubmitBtn', 'click', submitRound);
    listenId(doc, 'scResContinue', 'click', afterResult);
    listenId(doc, 'scLeaveBtn', 'click', leave);
    listenId(doc, 'scEndNewBtn', 'click', () => {
      state = null;
      save();
      openFreshSetup();
    });
    listenId(doc, 'scEndKeepBtn', 'click', openGame);
    listenId(doc, 'scRulesBtn2', 'click', () => {
      screens.openRules();
    });
    ['scHistoryBtn', 'scEndHistoryBtn'].forEach((id) => {
      listenId(doc, id, 'click', openHistory);
    });
    ['scExportBtn', 'scEndExportBtn'].forEach((id) => {
      listenId(doc, id, 'click', exportGame);
    });
    listenId(doc, 'scVoiceBtn', 'click', startVoiceEntry);
  };

  const resume = (): void => {
    const saved = loadSaved();
    if (saved === null) return;
    state = saved;
    resetCur(saved.players);
    if (winnerOf(saved) !== null) openEnd(ranked(saved));
    else openGame();
  };

  return { saved: loadSaved, resume, bind, state: () => state };
};
