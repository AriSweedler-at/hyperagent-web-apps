// The paint (docs/design/rps-island.md §3 step 5): the App onto the page's fixed ids through the
// DOM edge, and the buttons bound to intents. The counter and its static face (the first frame of
// the band's set, drawn from the sheet), the animated buddy (the band's loop; a hop between
// neighbouring bands when the band changes, played once then the new loop), the computer's hand,
// the window bar, the verdict with the reaction, Tech up with what it costs when eligible, Stop
// while a next round is pending, the sound button.
import {
  addClass,
  listenId,
  removeClass,
  requireId,
  setAttr,
  setDisabled,
  setHidden,
  setStyle,
  setText,
  toggleClass,
  type DocumentLike,
  type Element,
} from '../../../../shared/edge/dom.ts';
import {
  BASE_WINDOW_MS,
  HANDS,
  HAND_GLYPH,
  atFloor,
  canTechUp,
  moodOf,
  nextWindow,
  type Hand,
  type Outcome,
} from '../engine/engine.ts';
import { LOOPS, SET_OF, hopBetween, hopMs, sheetUrl, type BuddySet } from './buddy.ts';
import { autoNext, type App, type Intent } from './state.ts';

/** The page's ids, as index.html carries them (tools/games.ts SOLO pins them in the built page). */
export const IDS = {
  app: 'app',
  counter: 'counter',
  face: 'counterFace',
  buddy: 'buddy',
  prestige: 'prestige',
  windowMs: 'windowMs',
  best: 'best',
  computerHand: 'computerHand',
  windowBar: 'windowBar',
  verdict: 'verdict',
  reaction: 'reaction',
  hands: 'hands',
  goBtn: 'goBtn',
  stopBtn: 'stopBtn',
  techUpBtn: 'techUpBtn',
  techUpCost: 'techUpCost',
  resetBtn: 'resetBtn',
  status: 'status',
  soundBtn: 'soundBtn',
  islandSlot: 'islandSlot',
} as const;

export const HAND_BUTTON_IDS: Readonly<Record<Hand, string>> = {
  rock: 'rockBtn',
  paper: 'paperBtn',
  scissors: 'scissorsBtn',
};

export const VERDICT_COPY: Readonly<Record<Outcome, string>> = {
  win: 'You win',
  tie: 'Tie',
  loss: 'You lose',
  timeout: 'Too slow',
};

export const IDLE_COPY = 'Tap Go. When the hand stops, beat it before the bar runs out.';
export const RESET_CONFIRM =
  'Reset progress? The counter, the speed, the prestige and the best all start over.';

/** The counter, signed: `+3`, `0`, `−2` (a real minus, as the island shows it). */
export const signed = (n: number): string =>
  n > 0 ? `+${String(n)}` : n < 0 ? `−${String(-n)}` : '0';

export type PaintOptions = Readonly<{
  /** `prefers-reduced-motion`: no hop, no loop, no shrinking bar. */
  reducedMotion: boolean;
  /** Arm the one hop timer: the loop is painted back when the hop has played. */
  afterHop: (ms: number, fn: () => void) => void;
}>;

/**
 * A sheet onto an element: the CSS sizes it `--frames` frames wide at the element's own `--px` per
 * frame (theme.css `.buddy`, `.face`: the scale is the layout bucket's, 3x and 2x on a phone, up
 * to 5x and 3x on a wide desktop window) and plays it with `steps(var(--frames))`.
 */
const paintSheet = (el: Element, sheet: string, frames: number, ms: number): void => {
  setStyle(el, 'background-image', `url(${sheetUrl(sheet)})`);
  setStyle(el, '--frames', String(frames));
  setStyle(el, '--ms', String(ms));
};

const paintLoop = (buddy: Element, set: BuddySet): void => {
  const loop = LOOPS[set];
  removeClass(buddy, 'hop', 'back');
  paintSheet(buddy, loop.sheet, loop.frames, loop.ms);
  setAttr(buddy, 'data-set', set);
};

/**
 * The buddy: on a band change between neighbours a hop once (in reverse on the way down), then
 * the new loop; a jump of two bands (a Reset) or reduced motion swaps the loop at once.
 */
const paintBuddy = (doc: DocumentLike, app: App, options: PaintOptions): void => {
  const buddy = requireId(doc, IDS.buddy);
  const set = SET_OF[moodOf(app.progress.counter)];
  const before = buddy.getAttribute('data-set');
  if (before === set) return;
  const hop = before === null || options.reducedMotion ? null : hopBetween(before as BuddySet, set);
  if (hop === null) {
    paintLoop(buddy, set);
    return;
  }
  paintSheet(buddy, hop.hop.sheet, hop.hop.frames, hop.hop.ms);
  addClass(buddy, 'hop');
  toggleClass(buddy, 'back', hop.reverse);
  setAttr(buddy, 'data-set', set);
  options.afterHop(hopMs(hop.hop), () => {
    paintLoop(buddy, set);
  });
};

const paintScore = (doc: DocumentLike, app: App): void => {
  const { progress } = app;
  const mood = moodOf(progress.counter);
  const set = SET_OF[mood];
  const loop = LOOPS[set];
  setText(requireId(doc, IDS.counter), signed(progress.counter));
  setAttr(requireId(doc, IDS.app), 'data-mood', mood);
  const face = requireId(doc, IDS.face);
  paintSheet(face, loop.sheet, loop.frames, loop.ms);
  setAttr(face, 'data-set', set);
  setText(
    requireId(doc, IDS.prestige),
    progress.prestige === 0 ? 'No prestige yet' : `Prestige ${String(progress.prestige)}`,
  );
  setText(requireId(doc, IDS.windowMs), `Window ${String(progress.windowMs)} ms`);
  setText(
    requireId(doc, IDS.best),
    progress.best === null ? 'No best yet' : `Best ${String(progress.best)} ms`,
  );
};

const paintTable = (doc: DocumentLike, app: App, options: PaintOptions): void => {
  const { phase } = app;
  const computer = requireId(doc, IDS.computerHand);
  const shown =
    phase.kind === 'scrolling'
      ? HAND_GLYPH[phase.shown]
      : phase.kind === 'idle'
        ? '?'
        : HAND_GLYPH[phase.computer];
  setText(computer, shown);
  toggleClass(computer, 'armed', phase.kind === 'armed');
  toggleClass(computer, 'scrolling', phase.kind === 'scrolling');
  const bar = requireId(doc, IDS.windowBar);
  setStyle(bar, '--window-ms', `${String(app.progress.windowMs)}ms`);
  toggleClass(bar, 'run', phase.kind === 'armed' && !options.reducedMotion);
  toggleClass(bar, 'still', phase.kind === 'armed' && options.reducedMotion);
  const verdict = requireId(doc, IDS.verdict);
  const reaction = requireId(doc, IDS.reaction);
  if (phase.kind === 'verdict') {
    setText(verdict, VERDICT_COPY[phase.outcome]);
    setAttr(verdict, 'data-outcome', phase.outcome);
    setText(
      reaction,
      phase.reactionMs === null
        ? `No tap within ${String(phase.windowMs)} ms`
        : `${String(phase.reactionMs)} ms`,
    );
  } else {
    setText(verdict, phase.kind === 'idle' ? IDLE_COPY : phase.kind === 'armed' ? 'Now!' : '…');
    setAttr(verdict, 'data-outcome', null);
    setText(reaction, '');
  }
  HANDS.forEach((hand) => {
    setDisabled(requireId(doc, HAND_BUTTON_IDS[hand]), phase.kind !== 'armed');
  });
};

const paintControls = (doc: DocumentLike, app: App): void => {
  const { phase, progress } = app;
  const busy = phase.kind === 'scrolling' || phase.kind === 'armed';
  const offer = canTechUp(progress) && !busy;
  const go = requireId(doc, IDS.goBtn);
  setHidden(go, busy);
  setText(go, phase.kind === 'verdict' || app.rounds > 0 ? 'Again' : 'Go');
  setHidden(requireId(doc, IDS.stopBtn), !autoNext(app));
  const tech = requireId(doc, IDS.techUpBtn);
  setHidden(tech, !offer);
  setText(
    requireId(doc, IDS.techUpCost),
    `${String(progress.windowMs)} → ${String(nextWindow(progress.windowMs))} ms`,
  );
  const status = requireId(doc, IDS.status);
  setText(
    status,
    offer
      ? 'Tech up: the counter resets, and you have 25% less time.'
      : atFloor(progress)
        ? `As fast as it gets: ${String(progress.windowMs)} ms.`
        : progress.windowMs < BASE_WINDOW_MS
          ? `Every loss adds 10% back to the window.`
          : '',
  );
  setDisabled(requireId(doc, IDS.resetBtn), busy);
};

/** The whole page from the App. */
export const paint = (doc: DocumentLike, app: App, options: PaintOptions): void => {
  paintScore(doc, app);
  paintBuddy(doc, app, options);
  paintTable(doc, app, options);
  paintControls(doc, app);
};

/** The speaker button: its glyph and pressed state. */
export const paintSound = (doc: DocumentLike, enabled: boolean): void => {
  const btn = requireId(doc, IDS.soundBtn);
  setText(btn, enabled ? '🔊' : '🔇');
  setAttr(btn, 'aria-pressed', enabled ? 'true' : 'false');
};

export type Bindings = Readonly<{
  dispatch: (intent: Intent) => void;
  /** Fresh draws for a round: the scroll's length. */
  go: () => void;
  /** The tap instant (`performance.now()`). */
  now: () => number;
  /** Behind a confirm; the edge asks. */
  reset: () => void;
  toggleSound: () => void;
}>;

export const bind = (doc: DocumentLike, b: Bindings): void => {
  listenId(doc, IDS.goBtn, 'click', b.go);
  listenId(doc, IDS.stopBtn, 'click', () => {
    b.dispatch({ type: 'stop' });
  });
  listenId(doc, IDS.techUpBtn, 'click', () => {
    b.dispatch({ type: 'techUp' });
  });
  listenId(doc, IDS.resetBtn, 'click', b.reset);
  listenId(doc, IDS.soundBtn, 'click', b.toggleSound);
  HANDS.forEach((hand) => {
    listenId(doc, HAND_BUTTON_IDS[hand], 'click', () => {
      b.dispatch({ type: 'tap', hand, at: b.now() });
    });
  });
};
