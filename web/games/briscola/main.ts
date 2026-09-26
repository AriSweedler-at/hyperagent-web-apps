// Boot (docs/ARCHITECTURE.md "Module boundaries": main.ts constructs the adapters and injects them;
// no logic). The first game booted through the shared boot alone (docs/design/briscola.md D18;
// web/shared/edge/boot.ts `bootShell`, docs/design/shared-shell.md §4.5): the real Transport, the
// ICE loader, localStorage, the clock, `Math.random` (or the harness's `window.__rng`), Web Audio,
// vibration and the wake lock, handed to the reducer (src/ui/state.ts) through `runEffect`, to the
// sessions (src/net) through their deps, and to the paint (src/ui/render.ts). This file passes the
// page's objects and what is briscola's: its reducer, painters, sessions, cue table, sound keys, the
// Italian suit sprite the glyph faces `<use>` (inlined once here, so it cannot drift from suits.ts),
// the card-pack and language-pack guards, the rules and About copy, the stories page's early
// return, and the members of `window.__briscola` (the documented test hook, D19) beyond the shared
// ones: `act`, `view`, `events`, `setup`, `cardPack`, `cardPackName`, `lang`, `langName`.
import { bootShell } from '../../shared/edge/boot.ts';
import { realClock } from '../../shared/edge/clock.ts';
import { browserStore, type Store } from '../../shared/edge/storage.ts';
import { badCardPackMsg, isCardPackFor } from '../../shared/lib/cards/packs.ts';
import { badLanguageMsg, isLanguagePack } from '../../shared/lib/lang/packs.ts';
import { SUIT_SPRITE_SVG } from '../../shared/ui/cardFace.ts';
import IMPACT_SPRITE_SVG from './impact/impact-sprite.svg?raw';
import { legalActions, type Action, type GameEvent, type View } from './src/engine/index.ts';
import { createFx } from './src/fx.ts';
import { GuestSession } from './src/net/guest.ts';
import { HostSession } from './src/net/host.ts';
import { isGuestFrame } from './src/protocol.ts';
import { DECK_KIND, STORAGE_KEYS, soundEnabled } from './src/storage.ts';
import { fillNameInputs, fillP2NameInput, setCodeInput } from './src/ui/home.ts';
import { bindAll, paint, paintSound, renderAbout, renderRules } from './src/ui/render.ts';
import {
  guestContextOf,
  hostContextOf,
  initialApp,
  readHome,
  reduce,
  runEffect,
  type App,
  type Briscola,
} from './src/ui/state.ts';

/**
 * The card pack (docs/design/card-packs.md §2): a value the console left in storage that names no
 * pack of the Italian deck is logged and dropped before every home read, so the deck's default
 * stands and a reload logs it once.
 */
const dropBadCardPack = (store: Store): void => {
  const stored = store.readText(STORAGE_KEYS.cardPack);
  if (stored.ok && !isCardPackFor(DECK_KIND, stored.value)) {
    console.error(badCardPackMsg(STORAGE_KEYS.cardPack, DECK_KIND, stored.value));
    store.remove(STORAGE_KEYS.cardPack);
  }
};

/** The language pack (docs/design/language-packs.md §3): the same guard over `briscola_lang`, so Italian stands. */
const dropBadLang = (store: Store): void => {
  const stored = store.readText(STORAGE_KEYS.lang);
  if (stored.ok && !isLanguagePack(stored.value)) {
    console.error(badLanguageMsg(STORAGE_KEYS.lang, stored.value));
    store.remove(STORAGE_KEYS.lang);
  }
};

const boot = (): void => {
  // The stories page (docs/design/briscola-board.md §7; docs/ARCHITECTURE.md "Documented test
  // hooks"): `?story=<id>` paints one catalogued table state and constructs no adapter at all. The
  // catalogue arrives as its own chunk (a dynamic import), so the game's entry carries none of it.
  const params = new URLSearchParams(location.search);
  const story = params.get('story');
  if (story !== null) {
    void import('./src/stories/boot.ts').then((stories) => {
      stories.bootStory(document, story, params.has('nav'), params.has('live'));
    });
    return;
  }
  bootShell<Briscola, App>({
    page: { doc: document, win: window, nav: navigator, store: browserStore(), clock: realClock },
    // PeerJS log level 0 as the other shell pages (e2e expectPeerOptions pins it, tools/games.ts REGISTRY).
    game: { hook: '__briscola', title: 'Briscola', debug: 0 },
    sound: { enabled: soundEnabled, fontKey: STORAGE_KEYS.soundFont },
    reducer: { initialApp, reduce, runEffect, readHome, hostContextOf, guestContextOf },
    // `paintSound` adds `aria-pressed` to the shared paint; the toast wears no marks.
    paint: {
      paint,
      bindAll,
      paintSound,
      fillName: fillNameInputs,
      fillP2Name: fillP2NameInput,
      setCode: setCodeInput,
    },
    fx: createFx,
    net: { Host: HostSession, Guest: GuestSession, isGuestFrame },
    legal: legalActions,
    deps: {},
    hooks: {
      home: (store) => {
        dropBadCardPack(store);
        dropBadLang(store);
      },
      // The four Italian suit symbols the glyph faces and the trump badge `<use>`, and the clash's
      // impact frames (impact/impact-sprite.svg, docs/design/briscola-battle.md §3.5), once, before
      // any paint, so nothing is fetched during play; then the rules into both slots and the About
      // copy (ui/rules.ts, ui/about.ts).
      render: () => {
        document.body.insertAdjacentHTML('afterbegin', SUIT_SPRITE_SVG);
        document.body.insertAdjacentHTML('afterbegin', IMPACT_SPRITE_SVG);
        renderRules(document);
        renderAbout(document);
      },
      // `act` through the reducer; `view` my view; `events` its event stream (the sounds' and the
      // history's one source); `setup` seats a position for e2e and stories (pass-and-play only: the
      // shell's `position/load` over the engine's decoder); `cardPack` shows and remembers a pack of
      // the Italian deck; `lang` names the cards in a language pack and remembers it.
      hook: ({ app, dispatch }) => ({
        act: (action: Action) => {
          dispatch({ type: 'act', action });
        },
        view: (): View | null => app().shell.view,
        events: (): ReadonlyArray<GameEvent> => app().shell.view?.events ?? [],
        setup: (state: unknown) => {
          dispatch({ type: 'position/load', state });
        },
        cardPack: (name: string): void => {
          if (!isCardPackFor(DECK_KIND, name)) {
            console.error(badCardPackMsg(STORAGE_KEYS.cardPack, DECK_KIND, name));
            return;
          }
          dispatch({ type: 'cardPack/set', pack: name });
        },
        cardPackName: (): string => app().table.cardPack,
        lang: (name: string): void => {
          if (!isLanguagePack(name)) {
            console.error(badLanguageMsg(STORAGE_KEYS.lang, name));
            return;
          }
          dispatch({ type: 'lang/set', name });
        },
        langName: (): string => app().table.lang,
      }),
    },
  });
};

boot();
