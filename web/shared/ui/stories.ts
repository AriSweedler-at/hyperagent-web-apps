// The stories page (docs/design/dry-round-2.md §3 I3, §5 G3; gin's docs/design/gin-draw-ghost-slot.md
// §8 spelled it first, and docs/ARCHITECTURE.md "Documented test hooks" names the hook): `?story=<id>`
// on a game's page paints one catalogued table state with the same `paint` main.ts uses, and nothing
// else happens: no store, no network, no ICE, no timers, no listeners. `?story=` alone lists the
// stories as links; `&nav` adds a prev/index/next bar (inline styles: the page's stylesheet must not
// learn a class for it, the class contract would demand a rule). `&live` binds the page's controls
// to the reducer over the story's App and repaints after every intent that changed it; what each
// effect does is the game's `runEffect` (gin runs the reducer's timers and its toasts and drops
// the rest: docs/design/gin-arrangement-and-discards.md §11), so a UI-only flow can be driven from
// a catalogued state without a game, a store or a network. This module knows no catalogue and no
// paint (shared-shell.md §7 risk 8: extension points only): a game hands both in through
// `StoriesDeps`, with its own reducer, binder, effect runner and the index's copy.
//
// Where `?story=` is read: the game's main.ts, before `bootShell` (the early return C3 left there),
// not a `bootShell(cfg).stories?` slot. The slot was costed at G3 and refused: the check has to run
// before the boot constructs anything (the page must build no adapter), so `bootShell` would return
// `BootCtx | null` and every caller and boot.test.ts would narrow it, past the ten shared lines the
// row allowed; and the dynamic `import()` that keeps the catalogue out of the entry chunk belongs
// beside the entry anyway. A game's main.ts spends eight lines on it; this module never sees the
// query, so `bootStory` takes the flags parsed.
import {
  appendHtml,
  escapeHtml,
  requireId,
  setHtml,
  trustedHtml,
  type PageLike,
} from '../edge/dom.ts';
import type { Ctx } from './shell.ts';

/**
 * The query key that names a story and its two flags, as gin's main.ts spells them before its
 * dynamic `import()` (it cannot import them from here: a static import would pull this module into
 * the entry chunk that import keeps it out of); exported so the next game's main.ts matches them.
 */
export const STORY_QUERY = { story: 'story', nav: 'nav', live: 'live' } as const;
/** The container the index is written into (every shell page carries it) and the bar's id. */
export const STORIES_IDS = { app: 'app', nav: 'storyNav' } as const;

/** What the page reads of a catalogued story; a game's catalogue holds more (its facts, its links). */
export type StoryLike<App> = Readonly<{
  /** kebab-case, unique; the `?story=` value and the screenshot file's stem. */
  id: string;
  title: string;
  app: App;
  /** Compared against a committed baseline by the game's stories spec; the index notes the others. */
  screenshot: boolean;
}>;

/** The game's side of the page: its catalogue, its paint and binder, its reducer over a fixed `ctx`. */
export type StoriesDeps<App, Intent, Effect, S extends StoryLike<App>> = Readonly<{
  stories: ReadonlyArray<S>;
  storyById: (id: string) => S | null;
  /** The game's `paint` with its own view choices made (gin: the slot hand view). */
  paint: (doc: PageLike, app: App) => void;
  bindAll: (doc: PageLike, dispatch: (intent: Intent) => void) => void;
  reduce: (
    app: App,
    intent: Intent,
    ctx: Ctx,
  ) => Readonly<{ app: App; effects: ReadonlyArray<Effect> }>;
  /** The reducer's seeded rng and pinned clock: the same numbers every open. */
  ctx: Ctx;
  /** What a live page does with an effect (gin: toasts shown, named timers armed, the rest dropped). */
  runEffect: (effect: Effect, dispatch: (intent: Intent) => void) => void;
}>;

/** The index's heading and the note under it (the game names its own design doc there). */
export type StoriesCopy = Readonly<{ title: string; blurb: string }>;

export type Stories<App, S extends StoryLike<App>> = Readonly<{
  /** The index: every story as a link into the navigable view, and a note when `id` named none. */
  indexHtml: (id: string) => string;
  /** The fixed bar above a story: the previous story, the index, the next story. */
  navHtml: (story: S) => string;
  /** The reducer over the story's App behind the page's controls, repainting after each intent that changed it. */
  bindLive: (initial: App) => void;
  /** Paint the story `id` names, or the index when it names none; `nav` adds the bar, `live` the controls. */
  bootStory: (id: string, nav: boolean, live?: boolean) => void;
}>;

const href = (id: string, nav: boolean): string =>
  `?${STORY_QUERY.story}=${encodeURIComponent(id)}${nav ? `&${STORY_QUERY.nav}` : ''}`;

const LINK = 'color:#4ade80;font-weight:700;text-decoration:none;';

/** The page over a game's catalogue: the four members gin's src/stories/boot.ts spelled, made generic. */
export const bootStories = <App, Intent, Effect, S extends StoryLike<App>>(
  doc: PageLike,
  deps: StoriesDeps<App, Intent, Effect, S>,
  copy: StoriesCopy,
): Stories<App, S> => {
  const indexHtml = (id: string): string => {
    const missing =
      id === ''
        ? ''
        : `<p style="color:#f87171;">No story named <code>${escapeHtml(id)}</code>.</p>`;
    const items = deps.stories
      .map(
        (s) =>
          `<li style="margin:6px 0;"><a href="${href(s.id, true)}" style="${LINK}">${s.id}</a>` +
          `<span style="color:#9cc9ac;"> — ${escapeHtml(s.title)}${s.screenshot ? '' : ' (no screenshot)'}</span></li>`,
      )
      .join('');
    return (
      `<div style="padding:16px;max-width:720px;margin:0 auto;font-size:0.95rem;">` +
      `<h1 style="margin:0 0 12px;">${copy.title}</h1>${missing}` +
      `<p style="color:#9cc9ac;">${copy.blurb}</p>` +
      `<ol style="padding-left:22px;">${items}</ol></div>`
    );
  };

  const navHtml = (story: S): string => {
    const at = deps.stories.findIndex((s) => s.id === story.id);
    const link = (target: S | undefined, label: string): string =>
      target === undefined
        ? `<span style="color:#9cc9ac;">${label}</span>`
        : `<a href="${href(target.id, true)}" style="${LINK}">${label}</a>`;
    return (
      `<div id="${STORIES_IDS.nav}" style="position:fixed;left:0;right:0;bottom:0;z-index:200;display:flex;justify-content:space-between;gap:12px;padding:6px 12px;background:rgba(0,0,0,0.75);color:#f2fdf6;font-size:0.8rem;">` +
      `${link(deps.stories[at - 1], '← prev')}<span><a href="${href('', false)}" style="${LINK}">index</a> · ${String(at + 1)}/${String(deps.stories.length)} · ${story.id}</span>${link(deps.stories[at + 1], 'next →')}</div>`
    );
  };

  const bindLive = (initial: App): void => {
    /* eslint-disable functional/immutable-data -- the one cell the live page keeps, as main.ts
       keeps it: the App between intents (the game's `runEffect` keeps whatever timers it arms) */
    const held = { app: initial };
    const dispatch = (intent: Intent): void => {
      const step = deps.reduce(held.app, intent, deps.ctx);
      step.effects.forEach((effect) => {
        deps.runEffect(effect, dispatch);
      });
      // As main.ts: no repaint for an unchanged App, or a card's pointerdown would kill its click.
      if (step.app === held.app) return;
      held.app = step.app;
      deps.paint(doc, held.app);
    };
    deps.bindAll(doc, dispatch);
    /* eslint-enable functional/immutable-data */
  };

  const bootStory = (id: string, nav: boolean, live = false): void => {
    const story = deps.storyById(id);
    if (story === null) {
      setHtml(requireId(doc, STORIES_IDS.app), trustedHtml(indexHtml(id)));
      return;
    }
    deps.paint(doc, story.app);
    if (live) bindLive(story.app);
    if (nav) appendHtml(doc.body, trustedHtml(navHtml(story)));
  };

  return { indexHtml, navHtml, bindLive, bootStory };
};
