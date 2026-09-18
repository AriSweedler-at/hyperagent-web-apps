// The UI state's initial value and its small readers (docs/MIGRATION.md step 9): typed from
// legacy/fidice/index.html lines 2685-2718 (bundle section "// src/view/ui.ts"); the shapes are in
// view/types.ts. `emptyLadder` is one shared record (both ladders start from the same two empty
// sets), as the bundle had it.
import type { Ladder, Picker, Ui } from './types.ts';

const emptyLadder: Ladder = { open: new Set(), closed: new Set(), allOpen: false };
const emptyPicker: Picker = { query: '', selected: null, highlight: 0, listOpen: false };

const initialUi = (shareBase: string, savedName: string): Ui => ({
  screen: 'menu',
  tab: 'play',
  role: null,
  mySeat: null,
  game: null,
  pending: null,
  nameForm: { name: savedName, lives: 0, botChoice: 'profiler', locals: [''] },
  configTarget: null,
  joinCode: '',
  localTable: false,
  handoff: null,
  shownSeat: null,
  busy: null,
  error: null,
  toast: null,
  ladders: { main: emptyLadder, spec: emptyLadder },
  picker: emptyPicker,
  rollSelection: new Set(),
  rollCup: false,
  rollHidden: false,
  showTruth: false,
  shareBase,
  now: 0,
});

/** This device holds the cup: a round is on, nothing is revealed, and its seat is the holder's. */
const isMyTurn = (ui: Ui): boolean => {
  const r = ui.game?.round;
  return (
    !!r &&
    ui.game.phase === 'playing' &&
    !ui.game.reveal &&
    ui.mySeat !== null &&
    r.holder === ui.mySeat
  );
};

const isHostUi = (ui: Ui): boolean => ui.role === 'host';

const playerLink = (ui: Ui, code: string): string => `${ui.shareBase}#join=${code}`;
const spectatorLink = (ui: Ui, code: string): string => `${ui.shareBase}#watch=${code}`;

export { emptyLadder, emptyPicker, initialUi, isMyTurn, isHostUi, playerLink, spectatorLink };
