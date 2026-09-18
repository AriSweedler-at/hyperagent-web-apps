// The UI state and the intents (docs/MIGRATION.md step 9): the shapes app/controller.ts reduces
// over, recovered from view/ui.js (`initialUi`), the screens' `dispatch` calls and the
// controller's `handle` switch. The view modules themselves are still the generated JavaScript in
// this phase; the controller binds their exports to these types at its import boundary, and the
// phase that types the screens moves the types into view/ui.ts. A module the manifest does not
// list, types only (as domain/types.ts and bots/types.ts).
import type { Action, Category, PublicState, Rank, Seat } from '../domain/types.ts';

export type Tab = 'play' | 'ladder' | 'rules';
export type Screen = 'menu' | 'name' | 'lobby' | 'game' | 'spec';
export type LadderId = 'main' | 'spec';
/** Who this device is: the host (which also plays, unless it watches), a guest player, a spectator. */
export type UiRole = 'host' | 'player' | 'spectator';

/** What the name screen leads to. */
export type Pending =
  | Readonly<{ kind: 'host' }>
  | Readonly<{ kind: 'solo'; bots: number }>
  | Readonly<{ kind: 'local' }>
  | Readonly<{ kind: 'join'; code: string }>;

/** Whose bot strategy the config screen edits: the solo form's, or a seated bot's. */
export type ConfigTarget = Readonly<{ kind: 'solo' }> | Readonly<{ kind: 'seat'; seat: Seat }>;

/** Pass-the-phone cover: shown to `seat`, tapped once (`confirm`) before it lifts. */
export type Handoff = Readonly<{ seat: Seat; stage: 'cover' | 'confirm' }>;

export type NameForm = Readonly<{
  name: string;
  lives: number;
  botChoice: string;
  locals: ReadonlyArray<string>;
}>;

/** Which ladder rows the player opened or closed by hand; `allOpen` overrides both. */
export type Ladder = Readonly<{
  open: ReadonlySet<string>;
  closed: ReadonlySet<string>;
  allOpen: boolean;
}>;

/** The bid search box. */
export type Picker = Readonly<{
  query: string;
  selected: Rank | null;
  highlight: number;
  listOpen: boolean;
}>;

/** What a ladder highlights: the current bid, the cup's true rank (spectators), rows dimmed. */
export type Marks = Readonly<{ bid: Rank | null; cup: Rank | null; dimAtOrBelow: Rank | null }>;

export type Ui = Readonly<{
  screen: Screen;
  tab: Tab;
  role: UiRole | null;
  mySeat: Seat | null;
  game: PublicState | null;
  pending: Pending | null;
  nameForm: NameForm;
  configTarget: ConfigTarget | null;
  joinCode: string;
  localTable: boolean;
  handoff: Handoff | null;
  /** The seat the cover was last lifted for (pass the phone). */
  shownSeat: Seat | null;
  busy: string | null;
  error: string | null;
  toast: string | null;
  ladders: Readonly<Record<LadderId, Ladder>>;
  picker: Picker;
  rollSelection: ReadonlySet<number>;
  rollCup: boolean;
  rollHidden: boolean;
  showTruth: boolean;
  shareBase: string;
  now: number;
}>;

export type PickerIntent =
  | Readonly<{ type: 'picker.query'; value: string }>
  | Readonly<{ type: 'picker.focus' }>
  | Readonly<{ type: 'picker.move'; delta: number }>
  | Readonly<{ type: 'picker.choose'; rank: Rank }>
  | Readonly<{ type: 'picker.close' }>
  | Readonly<{ type: 'picker.enter' }>;

export type Intent =
  | Readonly<{ type: 'nav'; tab: Tab }>
  | Readonly<{ type: 'menu.create' }>
  | Readonly<{ type: 'menu.solo' }>
  | Readonly<{ type: 'menu.local' }>
  | Readonly<{ type: 'menu.watchBots' }>
  | Readonly<{ type: 'menu.join' }>
  | Readonly<{ type: 'form.name'; value: string }>
  | Readonly<{ type: 'form.lives'; value: number }>
  | Readonly<{ type: 'form.difficulty'; value: string }>
  | Readonly<{ type: 'form.code'; value: string }>
  | Readonly<{ type: 'form.local.set'; index: number; value: string }>
  | Readonly<{ type: 'form.local.add' }>
  | Readonly<{ type: 'form.local.remove'; index: number }>
  | Readonly<{ type: 'form.submit' }>
  | Readonly<{ type: 'form.back' }>
  | Readonly<{ type: 'config.open'; target: ConfigTarget }>
  | Readonly<{ type: 'config.close' }>
  | Readonly<{ type: 'config.pick'; choice: string }>
  | Readonly<{ type: 'handoff.tap' }>
  | Readonly<{ type: 'handoff.confirm' }>
  | Readonly<{ type: 'lobby.start' }>
  | Readonly<{ type: 'lobby.addBot' }>
  | Readonly<{ type: 'lobby.removeBot'; seat: Seat }>
  | Readonly<{ type: 'lobby.renameBot'; seat: Seat; name: string }>
  | Readonly<{ type: 'lobby.setBot'; seat: Seat; choice: string }>
  | Readonly<{ type: 'lobby.watch'; watching: boolean }>
  | Readonly<{ type: 'copy'; text: string }>
  | Readonly<{ type: 'leave' }>
  | Readonly<{ type: 'play'; action: Action }>
  | Readonly<{ type: 'roll.toggleDie'; die: number }>
  | Readonly<{ type: 'roll.cup'; on: boolean }>
  | Readonly<{ type: 'roll.hidden'; on: boolean }>
  | Readonly<{ type: 'roll.go' }>
  | PickerIntent
  | Readonly<{ type: 'picker.place' }>
  | Readonly<{ type: 'ladder.toggle'; ladder: LadderId; key: string }>
  | Readonly<{ type: 'ladder.expandAll'; ladder: LadderId }>
  | Readonly<{ type: 'ladder.jump'; cat: Category }>
  | Readonly<{ type: 'ladder.showBid' }>
  | Readonly<{ type: 'spec.truth'; on: boolean }>;

export type Dispatch = (intent: Intent) => void;

/** A rendered tree, opaque to the controller: view/vdom builds and mounts it. */
export type VNode = Readonly<{ kind: string }>;
