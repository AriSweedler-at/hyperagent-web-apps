// The shell's effect runner (docs/design/shared-shell.md §4.2 `runShellEffect`, moved out of both
// games' `ui/state.ts` in §5 C2): one `ShellEffect` against the adapters main.ts constructs and
// the tests record. Beside shell.ts rather than in it because it calls the adapters, statements
// the pure lint profile refuses (eslint.config.js `PURE` carves this file out as it does the
// painters); it is still DOM-free, so tsconfig.pure.json and tsconfig.node.json compile it. The
// storage writes go through the game's `cfg.prefs` (web/shared/edge/prefs.ts `shellStore` over its
// keys), the store itself being the game's type (`G['Store']`): this zone never names the edge. A
// game's `runEffect` handles its own effects first (`isShellEffect` is the partition) and hands
// the rest here with its shell, whose `soundFont` every cue plays in.
import {
  readHome,
  saveFor,
  type Cue,
  type GuestFrameOf,
  type HostFrameOf,
  type Intent,
  type SeatOf,
  type ShellConfig,
  type ShellEffect,
  type ShellState,
  type ShellTypes,
  type TimerId,
} from './shell.ts';
import type { RulesSlot } from './glossary.ts';
import type { SoundFontName } from '../lib/sound/fonts.ts';
import type { Phrase } from '../lib/sound/phrase.ts';

/** An N-seat room's terms for the host session (`HostOptions.capacity`/`waiting`/`names`), off the `startHost` effect. */
export type HostRoom = Readonly<{
  capacity: number;
  waiting?: string;
  names?: ReadonlyArray<string | null>;
}>;

/** The adapters a shell effect reaches; a game's `EffectDeps` is this plus its own. */
export type ShellEffectDeps<G extends ShellTypes> = Readonly<{
  store: G['Store'];
  toast: (message: string, ms: number | null) => void;
  /**
   * A cue of the game's table, or phrases already chosen (`eventEffects`), in the App's font: the
   * reducer's state is the source of truth for both. One dep for both so a game's deps never
   * miss the second path (boot.ts wires it to the cue player's `play` and `playPhrases`).
   */
  fx: (what: Cue<G> | ReadonlyArray<Phrase>, font: SoundFontName) => void;
  wakeLock: (hold: boolean) => void;
  net: Readonly<{
    /** Open the room; `room` is an N-seat game's capacity and open status (n-seat-sessions.md §7), never passed for a two-seat game. */
    startHost: (code: string, attempt: number, resume: boolean, room?: HostRoom) => void;
    startGuest: (code: string, attempt: number) => void;
    /** To the session; `seat` names one of a host's channels, passed only when the effect carries one. */
    send: (frame: HostFrameOf<G> | GuestFrameOf<G>, seat?: SeatOf<G>) => void;
    close: () => void;
  }>;
  confirm: (message: string) => boolean;
  scrollTop: () => void;
  timers: Readonly<{
    start: (id: TimerId<G>, ms: number, then: Intent<G>) => void;
    cancel: (id: TimerId<G>) => void;
  }>;
  toggleSound: () => void;
  /** The invite for the room `code`: its link, through the share sheet or the clipboard. */
  share: (code: string) => void;
  /** `revealRule(document, slot, rule)` (web/shared/edge/glossary.ts): scroll to the rule and flash it. */
  revealRule: (slot: RulesSlot, rule: string) => void;
  /**
   * The three input writes the paint does not own (they would fight the player's typing);
   * `isDefault` is the fill's `default` mark (shell.ts: the prefill the page clears on the first tap).
   */
  page: Readonly<{
    fillName: (name: string, isDefault: boolean) => void;
    fillP2Name: (name: string, isDefault: boolean) => void;
    setCode: (value: string) => void;
  }>;
  dispatch: (intent: Intent<G>) => void;
}>;

/** One shell effect against the adapters; `shell` is the state after the step that produced it. */
export const runShellEffect = <G extends ShellTypes>(
  shell: ShellState<G>,
  effect: ShellEffect<G>,
  deps: ShellEffectDeps<G>,
  cfg: ShellConfig<G>,
): void => {
  switch (effect.type) {
    case 'persist': {
      const save = saveFor(shell);
      if (save !== null) cfg.prefs.save.writeSave(deps.store, save);
      return;
    }
    case 'clearSave':
      cfg.prefs.save.clearSave(deps.store);
      return;
    case 'saveLocal':
      cfg.prefs.save.writeSave(deps.store, { role: 'local', game: effect.game });
      return;
    case 'rememberName':
      cfg.prefs.name.write(deps.store, effect.name);
      return;
    case 'rememberP2Name':
      cfg.prefs.p2Name.write(deps.store, effect.name);
      return;
    case 'writeHomeTab':
      cfg.prefs.homeTab.write(deps.store, effect.tab);
      return;
    case 'writePlayMode':
      cfg.prefs.playMode.write(deps.store, effect.mode);
      return;
    case 'writeSoundFont':
      cfg.prefs.soundFont.write(deps.store, effect.font);
      return;
    case 'recordGame':
      cfg.prefs.recentGames.append(deps.store, effect.game);
      return;
    case 'toast':
      deps.toast(effect.message, effect.ms);
      return;
    case 'send':
      // The seat is passed only when the effect names one, so a two-seat game's adapter is called as it was.
      if (effect.seat === undefined) deps.net.send(effect.frame);
      else deps.net.send(effect.frame, effect.seat);
      return;
    case 'fx':
      deps.fx(effect.cue, shell.soundFont);
      return;
    case 'phrases':
      deps.fx(effect.phrases, shell.soundFont);
      return;
    case 'wakeLock':
      deps.wakeLock(effect.hold);
      return;
    case 'startHost':
      // The room's terms ride only when the effect carries a capacity (an N-seat game), so a two-seat game's adapter is called as it was.
      if (effect.capacity === undefined)
        deps.net.startHost(effect.code, effect.attempt, effect.resume);
      else
        deps.net.startHost(effect.code, effect.attempt, effect.resume, {
          capacity: effect.capacity,
          ...(effect.waiting === undefined ? {} : { waiting: effect.waiting }),
          ...(effect.names === undefined ? {} : { names: effect.names }),
        });
      return;
    case 'startGuest':
      deps.net.startGuest(effect.code, effect.attempt);
      return;
    case 'closeNet':
      deps.net.close();
      return;
    case 'confirm':
      if (deps.confirm(effect.message)) deps.dispatch(effect.then);
      return;
    case 'then':
      deps.dispatch(effect.intent);
      return;
    case 'initHome':
      deps.dispatch({ type: 'home/init', home: readHome(deps.store, cfg) });
      return;
    case 'scrollTop':
      deps.scrollTop();
      return;
    case 'startTimer':
      deps.timers.start(effect.id, effect.ms, effect.then);
      return;
    case 'cancelTimer':
      deps.timers.cancel(effect.id);
      return;
    case 'toggleSound':
      deps.toggleSound();
      return;
    case 'share':
      deps.share(effect.code);
      return;
    case 'revealRule':
      deps.revealRule(effect.slot, effect.rule);
      return;
    case 'fillName':
      deps.page.fillName(effect.name, effect.default === true);
      return;
    case 'fillP2Name':
      deps.page.fillP2Name(effect.name, effect.default === true);
      return;
    case 'setCode':
      deps.page.setCode(effect.value);
      return;
  }
};
