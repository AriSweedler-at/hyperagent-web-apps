// The table's status strings and sound-cue machine (docs/MIGRATION.md step 11), ported from
// `render()` and `playCuesFor()` of the legacy multiplayer UI (legacy/gin-rummy/index.html,
// pinned in test/fixtures/legacy/gin-ui.cjs). Everything here is a pure function of the view and
// the player's selection; test/parity/gin.ui.test.ts runs each beside the legacy cut over seeded
// views. The cue machine's mutable `cueState` becomes a value threaded through `nextCue`.
import type { View } from '../engine/types.ts';

export type Status = Readonly<{ main: string; sub: string }>;
/** The selected card's id, or null. */
export type Selection = string | null;

/** The legacy `render()` dropped a selection that was no longer in the hand before drawing it. */
export const selectionIn = (view: View, selection: Selection): Selection =>
  selection !== null && view.me.hand.some((c) => c.id === selection) ? selection : null;

/** `#statusMain` / `#statusSub` for a view (empty at gameOver, which the end screen shows instead). */
export const statusFor = (view: View, selection: Selection): Status => {
  if (view.phase === 'roundOver') {
    return {
      main: view.result?.void === true ? 'Hand void' : 'Hand over',
      sub: 'See results',
    };
  }
  if (!view.isMyTurn) {
    return {
      main: `${view.opp.name}'s turn`,
      sub:
        view.phase === 'upcard'
          ? 'Deciding on the upcard…'
          : view.phase === 'draw'
            ? 'Drawing a card…'
            : 'Choosing a discard…',
    };
  }
  switch (view.phase) {
    case 'upcard':
      return { main: 'Your turn', sub: 'Take the upcard or pass' };
    case 'draw':
      return {
        main: 'Your turn',
        sub: view.forceStock
          ? 'Both passed — tap the stock to draw'
          : 'Tap the stock or the discard pile',
      };
    case 'discard':
      return {
        main: 'Your turn',
        sub:
          selection !== null && selection !== ''
            ? 'Discard it, or knock if you can'
            : 'Tap a card to select it',
      };
    case 'gameOver':
      return { main: '', sub: '' };
  }
};

/** What the ghost draw slot (ui/hand/draw.ts) needs of a stage to word the status. */
export type StatusStage = Readonly<{ kind: 'waiting' | 'shown' }> | null;

/**
 * `statusFor` with the ghost draw slot's two moments in front of it (docs/design/
 * gin-draw-ghost-slot.md §3): the draw awaited, then the drawn card shown until it is accepted.
 * `statusFor` itself is untouched, so its legacy golden stands.
 */
export const statusWith = (view: View, selection: Selection, stage: StatusStage): Status => {
  if (stage === null) return statusFor(view, selection);
  return stage.kind === 'waiting'
    ? { main: 'Your turn', sub: 'Drawing…' }
    : { main: 'Your turn', sub: 'Tap the new card to keep it, or pick a discard' };
};

/**
 * The deadwood readout above the hand: while choosing a discard it shows what the selected card
 * would leave, or the best any discard could leave; otherwise the hand's deadwood.
 */
export const deadwoodText = (view: View, selection: Selection): string => {
  const options = view.discardOptions;
  if (view.phase === 'discard' && view.isMyTurn && options !== null) {
    const chosen = selection === null ? undefined : options[selection];
    if (chosen !== undefined && !('locked' in chosen)) {
      return `Deadwood after discard: ${String(chosen.deadwood)}`;
    }
    const best = Math.min(
      ...Object.values(options).flatMap((o) => ('locked' in o ? [] : [o.deadwood])),
    );
    return `Best possible deadwood: ${String(best)}`;
  }
  return `Deadwood: ${String(view.me.deadwoodValue)}`;
};

/** The duration formatter is the scorer's (its CSV export shares it); the golden test is beside this file. */
export { fmtDuration } from '../scorer/format.ts';

// ---- sound cues --------------------------------------------------------------------------------

/** The `fx` method the legacy called, plus the port's two pickup cues (`oppDrawCue`). */
export type Cue =
  'yourTurn' | 'knockGood' | 'gin' | 'bad' | 'neutral' | 'win' | 'lose' | 'oppStock' | 'oppDiscard';
/** `local` is pass-and-play on one phone; `online` a host or a guest. */
export type CueRole = 'local' | 'online';
/** What `playCuesFor` remembered between renders so each event chimes once. */
export type CueState = Readonly<{ key: string | null; turnKey: string | null }>;
export const INITIAL_CUES: CueState = { key: null, turnKey: null };
export type Cued = Readonly<{ state: CueState; cue: Cue | null }>;

const totalsKey = (view: View): string => view.players.map((p) => String(p.total)).join(',');

/**
 * The opponent picked up a card (the owner, 2026-09-22: "when the opponent picks up from the
 * stock or from the discard pile, a sound should be played"): `prev` was their draw or upcard
 * decision, `next` is their discard phase of the same hand, and the stock or the discard pile is
 * one card shorter. Beside `nextCue`, not in it: the legacy machine never fired here, and its
 * parity golden stands. Null without a previous view (a join, a resume, a reload) and on one
 * phone, where whoever drew is holding it (ui/state.ts gates the role).
 */
export const oppDrawCue = (prev: View | null, next: View): Cue | null => {
  if (prev === null || next.isMyTurn || next.phase !== 'discard') return null;
  if (prev.handNumber !== next.handNumber || prev.phase === 'discard') return null;
  if (next.stockCount < prev.stockCount) return 'oppStock';
  if (next.discardCount < prev.discardCount) return 'oppDiscard';
  return null;
};

/** The cue a freshly rendered view fires, if any, and the state to carry to the next render. */
export const nextCue = (prev: CueState, view: View, role: CueRole): Cued => {
  const me = view.me.idx;
  const once = (key: string, cue: Cue, turnKey: string | null = prev.turnKey): Cued =>
    prev.key === key
      ? { state: { key: prev.key, turnKey }, cue: null }
      : { state: { key, turnKey }, cue };
  if (role === 'local') {
    // One phone: turn chimes come from the curtain; results are shared, so the cues are neutral-positive.
    if (view.phase === 'roundOver' && view.result !== null) {
      const r = view.result;
      return once(
        `round:${String(r.ts)}`,
        r.void ? 'neutral' : r.outcome === 'gin' ? 'gin' : 'knockGood',
      );
    }
    if (view.phase === 'gameOver') return once(`over:${totalsKey(view)}`, 'win');
    return { state: prev, cue: null };
  }
  if (view.phase === 'gameOver') {
    return once(
      `over:${String(view.handNumber)}:${totalsKey(view)}`,
      view.winner === me ? 'win' : 'lose',
    );
  }
  if (view.phase === 'roundOver' && view.result !== null) {
    const r = view.result;
    const cue: Cue = r.void
      ? 'neutral'
      : r.scorerIdx === me
        ? r.outcome === 'gin'
          ? 'gin'
          : 'knockGood'
        : 'bad';
    return once(`round:${String(r.ts)}`, cue, null);
  }
  const tk = `${String(view.handNumber)}:${view.phase}:${String(view.turn)}:${view.upcardStage ?? ''}`;
  const prevWasMine = prev.turnKey?.endsWith(':me') === true;
  if (view.isMyTurn && view.phase !== 'discard') {
    const mine = `${tk}:me`;
    return {
      state: { key: prev.key, turnKey: mine },
      cue: prev.turnKey !== mine && !prevWasMine ? 'yourTurn' : null,
    };
  }
  return {
    state: { key: prev.key, turnKey: `${tk}:${view.isMyTurn ? 'me' : 'them'}` },
    cue: null,
  };
};
