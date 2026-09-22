// The stories page (docs/design/gin-draw-ghost-slot.md §8; docs/ARCHITECTURE.md "Documented test
// hooks"): `?story=<id>` on the gin page paints one catalogued table state with the same `paint`
// and the same hand view main.ts uses, and nothing else happens: no store, no network, no ICE, no
// timers, no listeners. main.ts imports this module dynamically and only when the query names a
// story, so the catalogue lands in its own chunk under dist/shared/assets/ and the game's entry
// carries none of it. `?story=` alone lists the stories as links; `&nav` adds a prev/index/next
// bar (inline styles: the page's stylesheet must not learn a class for it, the class contract
// would demand a rule). `&live` (docs/design/gin-arrangement-and-discards.md §11) binds the page's
// controls to the reducer over the story's App and repaints after every intent, running only the
// reducer's timers (the long press) and its toasts (shown, never hidden) and dropping every other
// effect: a UI-only flow (the meld chooser, Arrange, a long press, a selection) can be driven from
// a catalogued state without a game, a store or a network; an intent that needs another effect (a
// persist, a send, a confirm) does nothing beyond its state change. e2e/gin-stories.spec.ts opens each story without either
// flag; e2e/gin-arrange.spec.ts uses `live`.
import {
  appendHtml,
  escapeHtml,
  requireId,
  setHtml,
  trustedHtml,
  type PageLike,
} from '../../../../shared/edge/dom.ts';
import { mulberry32 } from '../../../../shared/lib/rng.ts';
import { slotHandView } from '../ui/hand/SlotHandView.ts';
import { bindAll, paint, renderRules, showToast } from '../ui/render.ts';
import { reduce, type App, type Effect, type Intent, type TimerId } from '../ui/state.ts';
import { EPOCH, SEED, STORIES, storyById, type Story } from './catalogue.ts';

const href = (id: string, nav: boolean): string =>
  `?story=${encodeURIComponent(id)}${nav ? '&nav' : ''}`;

const LINK = 'color:#4ade80;font-weight:700;text-decoration:none;';

/** The index: every story as a link into the navigable view, and a note when `id` named none. */
const indexHtml = (id: string): string => {
  const missing =
    id === '' ? '' : `<p style="color:#f87171;">No story named <code>${escapeHtml(id)}</code>.</p>`;
  const items = STORIES.map(
    (s) =>
      `<li style="margin:6px 0;"><a href="${href(s.id, true)}" style="${LINK}">${s.id}</a>` +
      `<span style="color:#9cc9ac;"> — ${escapeHtml(s.title)}${s.screenshot ? '' : ' (no screenshot)'}</span></li>`,
  ).join('');
  return (
    `<div style="padding:16px;max-width:720px;margin:0 auto;font-size:0.95rem;">` +
    `<h1 style="margin:0 0 12px;">Gin Rummy stories</h1>${missing}` +
    `<p style="color:#9cc9ac;">Each link paints one catalogued table state (docs/design/gin-draw-ghost-slot.md §7) with the real paint; nothing is connected or saved.</p>` +
    `<ol style="padding-left:22px;">${items}</ol></div>`
  );
};

/** The fixed bar above a story: the previous story, the index, the next story. */
const navHtml = (story: Story): string => {
  const at = STORIES.findIndex((s) => s.id === story.id);
  const link = (target: Story | undefined, label: string): string =>
    target === undefined
      ? `<span style="color:#9cc9ac;">${label}</span>`
      : `<a href="${href(target.id, true)}" style="${LINK}">${label}</a>`;
  return (
    `<div id="storyNav" style="position:fixed;left:0;right:0;bottom:0;z-index:200;display:flex;justify-content:space-between;gap:12px;padding:6px 12px;background:rgba(0,0,0,0.75);color:#f2fdf6;font-size:0.8rem;">` +
    `${link(STORIES[at - 1], '← prev')}<span><a href="${href('', false)}" style="${LINK}">index</a> · ${String(at + 1)}/${String(STORIES.length)} · ${story.id}</span>${link(STORIES[at + 1], 'next →')}</div>`
  );
};

/**
 * The reducer over the story's App behind the page's controls, repainting after each intent that
 * changed it; of the effects only the named timers (the long press needs its `cardPress` timer, on
 * the page's own clock) and the toasts run.
 */
const bindLive = (doc: PageLike, initial: App): void => {
  /* eslint-disable functional/immutable-data -- the two cells the live page keeps, as main.ts
     keeps them: the App between intents and the armed timers */
  const ctx = { rng: mulberry32(SEED), now: (): number => EPOCH };
  const held = { app: initial };
  const timers = new Map<TimerId, ReturnType<typeof setTimeout>>();
  const runTimer = (effect: Effect, dispatch: (intent: Intent) => void): void => {
    if (effect.type === 'toast') showToast(doc, effect.message);
    if (effect.type !== 'startTimer' && effect.type !== 'cancelTimer') return;
    clearTimeout(timers.get(effect.id));
    timers.delete(effect.id);
    if (effect.type === 'startTimer')
      timers.set(
        effect.id,
        setTimeout(() => {
          dispatch(effect.then);
        }, effect.ms),
      );
  };
  const dispatch = (intent: Intent): void => {
    const step = reduce(held.app, intent, ctx);
    step.effects.forEach((effect) => {
      runTimer(effect, dispatch);
    });
    // As main.ts: no repaint for an unchanged App, or a card's pointerdown would kill its click.
    if (step.app === held.app) return;
    held.app = step.app;
    paint(doc, held.app, slotHandView);
  };
  bindAll(doc, dispatch);
  /* eslint-enable functional/immutable-data */
};

/** Paint the story `id` names, or the index when it names none; `nav` adds the bar, `live` the controls. */
export const bootStory = (doc: PageLike, id: string, nav: boolean, live = false): void => {
  renderRules(doc);
  const story = storyById(id);
  if (story === null) {
    setHtml(requireId(doc, 'app'), trustedHtml(indexHtml(id)));
    return;
  }
  paint(doc, story.app, slotHandView);
  if (live) bindLive(doc, story.app);
  if (nav) appendHtml(doc.body, trustedHtml(navHtml(story)));
};
