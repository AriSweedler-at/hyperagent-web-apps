// The reducer over intents (docs/MIGRATION.md step 9): typed from legacy/fidice/index.html lines
// 3529-3958 (bundle section "// src/app/controller.ts"); every state transition, toast, timer
// and session call is the same. It owns the UI state (view/types.ts `Ui`), turns the screens'
// intents into state patches and session calls, and re-renders through view/vdom after each.
// Sessions, effects, the clock and the document come from main.ts. Known legacy defect, kept
// until docs/MIGRATION.md step 15: one toast timer, so a second toast within TOAST_MS restarts
// the first one's countdown instead of queueing.
import type { Clock, Timer } from '../../../../shared/lib/clock.ts';
import { difficultyById } from '../bots/registry.ts';
import { CATEGORY_INFO, groupByKey, handAt } from '../domain/hands.ts';
import { suggestHands } from '../domain/search.ts';
import type { Action, PublicState, Rank, Seat } from '../domain/types.ts';
import type { ClientSession } from '../net/client.ts';
import type { HostOptions, HostSession } from '../net/host.ts';
import type { Role } from '../net/protocol.ts';
import type { HostEvents, Me, SessionEvents } from '../net/session.ts';
import { appView } from '../view/app.ts';
import { catId, catKey, isOpen, mainMarks, rowId } from '../view/screens/ladder.ts';
import { spectatorMarks } from '../view/screens/spectator.ts';
import type {
  Dispatch,
  Intent,
  Ladder,
  LadderId,
  Marks,
  Picker,
  PickerIntent,
  Screen,
  Ui,
  UiRole,
} from '../view/types.ts';
import { emptyLadder, emptyPicker, initialUi, isMyTurn } from '../view/ui.ts';
import { mount } from '../view/vdom.ts';
import type { Effects } from './effects.ts';

/** localStorage key of the player's name. */
const NAME_KEY = 'fidice-name';
const TOAST_MS = 2200;
/** The "next round in Ns" countdown refresh. */
const TICK_MS = 500;
/** How long the small handoff confirm stays before the cover comes back. */
const HANDOFF_CONFIRM_MS = 2500;
/** The table-talk elements kept scrolled to their newest line. */
const LOG_IDS: ReadonlyArray<string> = ['log', 'spec-log'];

export type Session = Readonly<HostSession> | Readonly<ClientSession>;

export type ControllerDeps = Readonly<{
  effects: Effects;
  clock: Clock;
  doc: Document;
  root: Element;
  makeHost: (opts: HostOptions, events: HostEvents) => HostSession;
  makeClient: (
    code: string,
    role: Role,
    name: string | null,
    events: SessionEvents,
  ) => ClientSession;
}>;

const toggleKey = (l: Ladder, key: string, open: boolean): Ladder => {
  const opened = new Set(l.open);
  const closed = new Set(l.closed);
  if (open) {
    opened.delete(key);
    closed.add(key);
  } else {
    closed.delete(key);
    opened.add(key);
  }
  return { ...l, open: opened, closed };
};

/** Open the category and group holding `rank`. */
const openPath = (l: Ladder, rank: Rank): Ladder => {
  const hnd = handAt(rank);
  const keys = [catKey(hnd.cat), hnd.groupKey];
  return {
    ...l,
    open: new Set([...l.open, ...keys]),
    closed: new Set([...l.closed].filter((k) => !keys.includes(k))),
  };
};

const withLadder = (ui: Ui, id: LadderId, f: (l: Ladder) => Ladder): Ui => ({
  ...ui,
  ladders: { ...ui.ladders, [id]: f(ui.ladders[id]) },
});

const currentBid = (ui: Ui): Rank | null => ui.game?.round?.bid ?? null;

const reducePicker = (p: Picker, intent: PickerIntent, bid: Rank | null): Picker => {
  const suggestions = suggestHands(p.query, bid);
  switch (intent.type) {
    case 'picker.query':
      return { ...p, query: intent.value, highlight: 0, listOpen: true };
    case 'picker.focus':
      return { ...p, listOpen: true };
    case 'picker.move':
      return {
        ...p,
        highlight: Math.max(0, Math.min(suggestions.length - 1, p.highlight + intent.delta)),
        listOpen: true,
      };
    case 'picker.choose':
      return { ...p, selected: intent.rank, listOpen: false };
    case 'picker.close':
      return { ...p, listOpen: false };
    case 'picker.enter': {
      const hit = suggestions[p.highlight];
      return p.listOpen && hit ? { ...p, selected: hit.rank, listOpen: false } : p;
    }
  }
};

const screenFor = (game: PublicState, me: Me, isHost: boolean): Screen => {
  if (me.role === 'spectator') return isHost && game.phase === 'lobby' ? 'lobby' : 'spec';
  return game.phase === 'lobby' ? 'lobby' : 'game';
};

/** The rank span a ladder key names: a category (`cat:<cat>`) or a group key. */
const keyRange = (key: string): Readonly<{ lo: Rank; hi: Rank }> | null => {
  if (key.startsWith('cat:')) {
    const c = CATEGORY_INFO.find((x) => x.cat === key.slice(4));
    return c ? { lo: c.minRank, hi: c.maxRank } : null;
  }
  const g = groupByKey(key);
  return g ? { lo: g.minRank, hi: g.maxRank } : null;
};

export class Controller {
  private ui: Ui;
  private session: Session | null = null;
  private host: HostSession | null = null;
  private hostName = 'Host';
  private toastTimer: Timer | null = null;
  private tickTimer: Timer | null = null;
  private handoffTimer: Timer | null = null;
  private shownLogLength = 0;
  private readonly deps: ControllerDeps;
  private readonly dispatch: Dispatch;

  constructor(deps: ControllerDeps, shareBase: string) {
    this.deps = deps;
    this.ui = initialUi(shareBase, deps.effects.storage.get(NAME_KEY) ?? '');
    this.dispatch = (intent) => {
      this.handle(intent);
    };
  }

  get state(): Ui {
    return this.ui;
  }

  /** Apply the URL hash (#join=CODE / #watch=CODE) and draw the first frame. */
  start(): void {
    const hash = /#(join|watch)=([A-Z0-9]{5})/i.exec(this.deps.effects.readHash());
    if (hash?.[1]?.toLowerCase() === 'watch' && hash[2])
      this.joinAs(hash[2].toUpperCase(), 'spectator', null);
    else if (hash?.[2])
      this.set({
        joinCode: hash[2].toUpperCase(),
        pending: { kind: 'join', code: hash[2].toUpperCase() },
        screen: 'name',
        error: null,
      });
    this.render();
  }

  private set(patch: Partial<Ui>): void {
    this.ui = { ...this.ui, ...patch };
  }

  private render(): void {
    mount(this.deps.doc, this.deps.root, appView(this.ui, this.dispatch));
    this.followLog();
    this.manageTicker();
  }

  /** Keep the table talk pinned to its newest line whenever a line is added. */
  private followLog(): void {
    const len = this.ui.game?.log.length ?? 0;
    if (len === this.shownLogLength) return;
    this.shownLogLength = len;
    LOG_IDS.forEach((id) => {
      this.deps.effects.scrollToBottom(id);
    });
  }

  private toast(message: string): void {
    this.set({ toast: message });
    if (this.toastTimer !== null) this.deps.clock.clearTimeout(this.toastTimer);
    this.toastTimer = this.deps.clock.setTimeout(() => {
      this.toastTimer = null;
      this.set({ toast: null });
      this.render();
    }, TOAST_MS);
  }

  /** Keep the "next round in Ns" countdown fresh while a reveal is showing. */
  private manageTicker(): void {
    const counting =
      !!this.ui.game?.reveal &&
      this.ui.game.autoNextAt !== null &&
      this.ui.game.phase === 'playing';
    if (counting && this.tickTimer === null) {
      this.tickTimer = this.deps.clock.setTimeout(() => {
        this.tickTimer = null;
        this.set({ now: this.deps.clock.now() });
        this.render();
      }, TICK_MS);
    }
  }

  /* ---------- sessions ---------- */

  private events(): SessionEvents {
    return {
      onReady: () => {
        this.set({ busy: null });
        this.render();
      },
      onState: (game, me) => {
        const isHost = this.session?.kind === 'host';
        const screen = screenFor(game, me, isHost);
        const role: UiRole = isHost ? 'host' : me.role;
        const changedScreen = screen !== this.ui.screen;
        const turnStarted = isMyTurn({ ...this.ui, game, mySeat: me.seat }) && !isMyTurn(this.ui);
        this.set({
          game,
          mySeat: me.seat,
          role,
          screen,
          busy: null,
          now: this.deps.clock.now(),
          ...(changedScreen ? { tab: 'play' } : {}),
          ...(turnStarted
            ? { picker: emptyPicker, rollSelection: new Set(), rollCup: false, rollHidden: false }
            : {}),
          ...this.handoffFor(game, me.seat),
        });
        this.render();
      },
      onInfo: (m) => {
        this.toast(m);
        this.render();
      },
      onError: (m) => {
        this.toast(m);
        this.render();
      },
      onClosed: (reason) => {
        this.teardown();
        this.set({ screen: 'name', error: reason, busy: null });
        this.render();
      },
    };
  }

  private teardown(): void {
    this.session?.close();
    this.session = null;
    this.host = null;
    this.clearHandoffTimer();
    this.set({
      game: null,
      mySeat: null,
      role: null,
      localTable: false,
      handoff: null,
      shownSeat: null,
    });
  }

  /* ---------- pass the phone ---------- */

  private clearHandoffTimer(): void {
    if (this.handoffTimer !== null) this.deps.clock.clearTimeout(this.handoffTimer);
    this.handoffTimer = null;
  }

  /**
   * At a pass-the-phone table the screen must be covered whenever the cup reaches a human who is
   * not the one we last uncovered it for. Computers' turns and the public reveal need no cover.
   */
  private handoffFor(game: PublicState, mySeat: Seat | null): Partial<Ui> {
    if (!this.ui.localTable || game.phase !== 'playing' || !game.round || game.reveal)
      return { handoff: null };
    const holder = game.round.holder;
    const human = game.players[holder]?.bot === null;
    if (!human || mySeat !== holder) return { handoff: null };
    if (holder === this.ui.shownSeat) return {};
    if (this.ui.handoff?.seat === holder) return {};
    this.clearHandoffTimer();
    return { handoff: { seat: holder, stage: 'cover' } };
  }

  /** The big cover was tapped: show the small confirm, but bring the cover back if it isn't pressed soon. */
  private handoffTap(): void {
    const h = this.ui.handoff;
    if (!h) return;
    this.set({ handoff: { ...h, stage: 'confirm' } });
    this.clearHandoffTimer();
    this.handoffTimer = this.deps.clock.setTimeout(() => {
      this.handoffTimer = null;
      if (this.ui.handoff?.stage === 'confirm') {
        this.set({ handoff: { ...this.ui.handoff, stage: 'cover' } });
        this.render();
      }
    }, HANDOFF_CONFIRM_MS);
  }

  private handoffConfirm(): void {
    const h = this.ui.handoff;
    if (h?.stage !== 'confirm') return;
    this.clearHandoffTimer();
    this.set({ handoff: null, shownSeat: h.seat });
  }

  private createHost(opts: Omit<HostOptions, 'code'>): void {
    this.teardown();
    const host = this.deps.makeHost(
      { ...opts, code: this.deps.effects.randomCode() },
      this.events(),
    );
    this.session = host;
    this.host = host;
    this.set({
      role: 'host',
      screen: opts.watch && opts.autostart ? 'spec' : 'lobby',
      busy: 'Setting up the table…',
      error: null,
    });
    this.render();
  }

  private joinAs(code: string, role: Role, name: string | null): void {
    this.teardown();
    this.session = this.deps.makeClient(code, role, name, this.events());
    this.set({
      role,
      screen: role === 'spectator' ? 'spec' : 'lobby',
      busy: 'Paddling out to the host…',
      error: null,
      game: null,
    });
    this.render();
  }

  private submitForm(): void {
    const name = this.ui.nameForm.name.trim().slice(0, 16) || 'Player';
    this.deps.effects.storage.set(NAME_KEY, name);
    this.hostName = name;
    const p = this.ui.pending;
    if (!p) return;
    if (p.kind === 'host')
      this.createHost({
        hostName: name,
        lives: this.ui.nameForm.lives,
        watch: false,
        bots: 0,
        autostart: false,
      });
    else if (p.kind === 'local') {
      const locals = this.ui.nameForm.locals
        .map((n) => n.trim().slice(0, 16))
        .filter((n) => n.length > 0);
      if (locals.length === 0) {
        this.set({ error: 'Add at least one more player to pass the phone to.' });
        return;
      }
      this.createHost({
        hostName: name,
        lives: this.ui.nameForm.lives,
        watch: false,
        bots: 0,
        autostart: false,
        locals,
      });
      this.set({ localTable: true });
    } else if (p.kind === 'solo')
      this.createHost({
        hostName: name,
        lives: this.ui.nameForm.lives,
        watch: false,
        bots: p.bots,
        autostart: false,
        botChoice: this.ui.nameForm.botChoice,
      });
    else {
      const code = this.ui.joinCode.trim().toUpperCase();
      if (code.length !== 5) {
        this.set({ error: 'Codes are 5 characters' });
        return;
      }
      this.set({ joinCode: code, pending: { kind: 'join', code } });
      this.joinAs(code, 'player', name);
    }
  }

  private leave(): void {
    const g = this.ui.game;
    if (
      this.host &&
      g?.phase === 'playing' &&
      !this.deps.effects.confirm('You are the host — leaving closes the table for everyone. Leave?')
    )
      return;
    this.teardown();
    this.deps.effects.setHash('');
    this.set({ screen: 'menu', tab: 'play', pending: null, error: null, busy: null });
  }

  private play(action: Action): void {
    if (!this.session) return;
    this.session.act(action);
    if (action.type === 'bid') this.set({ picker: emptyPicker });
    if (action.type === 'roll')
      this.set({ rollSelection: new Set(), rollCup: false, rollHidden: false });
  }

  /* ---------- intents ---------- */

  private handle(intent: Intent): void {
    switch (intent.type) {
      case 'nav':
        this.set({ tab: intent.tab });
        this.deps.effects.scrollToTop();
        break;
      case 'menu.create':
        this.set({ pending: { kind: 'host' }, screen: 'name', error: null });
        break;
      case 'menu.solo':
        this.set({ pending: { kind: 'solo', bots: 2 }, screen: 'name', error: null });
        break;
      case 'menu.local':
        this.set({ pending: { kind: 'local' }, screen: 'name', error: null });
        break;
      case 'form.local.set':
        this.set({
          nameForm: {
            ...this.ui.nameForm,
            locals: this.ui.nameForm.locals.map((n, i) => (i === intent.index ? intent.value : n)),
          },
        });
        break;
      case 'form.local.add':
        if (this.ui.nameForm.locals.length < 5)
          this.set({
            nameForm: { ...this.ui.nameForm, locals: [...this.ui.nameForm.locals, ''] },
          });
        break;
      case 'form.local.remove':
        this.set({
          nameForm: {
            ...this.ui.nameForm,
            locals: this.ui.nameForm.locals.filter((_, i) => i !== intent.index),
          },
        });
        break;
      case 'handoff.tap':
        this.handoffTap();
        break;
      case 'handoff.confirm':
        this.handoffConfirm();
        break;
      case 'menu.watchBots':
        this.hostName = 'Host';
        this.createHost({ hostName: 'Host', lives: 3, watch: true, bots: 4, autostart: true });
        break;
      case 'menu.join':
        this.set({ pending: { kind: 'join', code: '' }, screen: 'name', error: null });
        break;
      case 'form.name':
        this.set({ nameForm: { ...this.ui.nameForm, name: intent.value } });
        break;
      case 'form.lives':
        this.set({ nameForm: { ...this.ui.nameForm, lives: intent.value } });
        break;
      case 'form.difficulty':
        this.set({
          nameForm: {
            ...this.ui.nameForm,
            botChoice: difficultyById(intent.value).strategy.id,
          },
        });
        break;
      case 'config.open':
        this.set({ configTarget: intent.target });
        this.deps.effects.scrollToTop();
        break;
      case 'config.close':
        this.set({ configTarget: null });
        break;
      case 'config.pick': {
        const target = this.ui.configTarget;
        if (!target) break;
        if (target.kind === 'solo')
          this.set({ nameForm: { ...this.ui.nameForm, botChoice: intent.choice } });
        else this.host?.setBot(target.seat, intent.choice);
        break;
      }
      case 'form.code':
        this.set({ joinCode: intent.value.toUpperCase() });
        break;
      case 'form.submit':
        this.submitForm();
        break;
      case 'form.back':
        this.teardown();
        this.set({ screen: 'menu', pending: null, error: null });
        break;
      case 'lobby.start':
        this.session?.act({ type: 'start' });
        break;
      case 'lobby.addBot':
        this.host?.addBot();
        break;
      case 'lobby.removeBot':
        this.host?.removeBot(intent.seat);
        break;
      case 'lobby.renameBot':
        this.host?.renameBot(intent.seat, intent.name);
        break;
      case 'lobby.setBot':
        this.host?.setBot(intent.seat, intent.choice);
        break;
      case 'lobby.watch':
        this.host?.hostWatches(intent.watching, this.hostName);
        break;
      case 'copy':
        void this.deps.effects.copyToClipboard(intent.text).then((ok) => {
          this.toast(ok ? 'Copied!' : 'Select the link and press Ctrl/Cmd+C to copy');
          this.render();
        });
        break;
      case 'leave':
        this.leave();
        break;
      case 'play':
        this.play(intent.action);
        break;
      case 'roll.toggleDie': {
        const sel = new Set(this.ui.rollSelection);
        if (sel.has(intent.die)) sel.delete(intent.die);
        else sel.add(intent.die);
        this.set({ rollSelection: sel });
        break;
      }
      case 'roll.cup':
        this.set({ rollCup: intent.on });
        break;
      // Tucking dice under the cup commits you to shaking the cup; un-tucking leaves the shake ticked until you untick it.
      case 'roll.hidden':
        this.set({ rollHidden: intent.on, ...(intent.on ? { rollCup: true } : {}) });
        break;
      case 'roll.go': {
        const { rollCup, rollHidden, rollSelection } = this.ui;
        if (!rollCup && rollSelection.size === 0) {
          this.toast('Select table dice or tick "Shake the cup" first');
          break;
        }
        const picked = [...rollSelection];
        const tucking = rollHidden && picked.length > 0;
        this.play({
          type: 'roll',
          cup: rollCup || tucking,
          table: tucking ? [] : picked,
          intoCup: tucking ? picked : [],
        });
        break;
      }
      case 'picker.query':
      case 'picker.focus':
      case 'picker.move':
      case 'picker.choose':
      case 'picker.close':
        this.set({ picker: reducePicker(this.ui.picker, intent, currentBid(this.ui)) });
        break;
      case 'picker.enter': {
        const before = this.ui.picker;
        const after = reducePicker(before, intent, currentBid(this.ui));
        if (after !== before) this.set({ picker: after });
        else if (before.selected !== null) this.play({ type: 'bid', rank: before.selected });
        break;
      }
      case 'picker.place':
        if (this.ui.picker.selected !== null)
          this.play({ type: 'bid', rank: this.ui.picker.selected });
        break;
      case 'ladder.toggle': {
        const marks =
          intent.ladder === 'main'
            ? mainMarks(this.ui)
            : this.ui.game
              ? spectatorMarks(this.ui, this.ui.game)
              : mainMarks(this.ui);
        const l = this.ui.ladders[intent.ladder];
        const open = this.isKeyOpen(l, intent.key, marks);
        this.set(withLadder(this.ui, intent.ladder, (x) => toggleKey(x, intent.key, open)));
        break;
      }
      case 'ladder.expandAll':
        this.set(
          withLadder(this.ui, intent.ladder, (l) => ({ ...emptyLadder, allOpen: !l.allOpen })),
        );
        break;
      case 'ladder.jump':
        this.set(
          withLadder(this.ui, 'main', (l) =>
            toggleKey(
              { ...l, closed: new Set([...l.closed].filter((k) => k !== catKey(intent.cat))) },
              catKey(intent.cat),
              false,
            ),
          ),
        );
        this.render();
        this.deps.effects.scrollIntoView(catId('main', intent.cat));
        return;
      case 'ladder.showBid': {
        const bid = currentBid(this.ui);
        this.set({
          tab: 'ladder',
          ...(bid === null ? {} : withLadder(this.ui, 'main', (l) => openPath(l, bid))),
        });
        this.render();
        if (bid !== null) this.deps.effects.scrollIntoView(rowId('main', bid));
        return;
      }
      case 'spec.truth':
        this.set({ showTruth: intent.on });
        break;
    }
    this.render();
  }

  private isKeyOpen(l: Ladder, key: string, marks: Marks): boolean {
    const range = keyRange(key);
    return range ? isOpen(l, key, range.lo, range.hi, marks) : l.open.has(key);
  }
}

export {
  NAME_KEY,
  TOAST_MS,
  TICK_MS,
  HANDOFF_CONFIRM_MS,
  LOG_IDS,
  toggleKey,
  openPath,
  withLadder,
  currentBid,
  reducePicker,
  screenFor,
  keyRange,
};
