// The stories page (docs/design/gin-draw-ghost-slot.md §8; docs/ARCHITECTURE.md "Documented test
// hooks"): `?story=<id>` on the gin page paints one catalogued table state with the same `paint`
// and the same hand view main.ts uses, and nothing else happens: no store, no network, no ICE, no
// timers, no listeners. main.ts imports this module dynamically and only when the query names a
// story, so the catalogue lands in its own chunk under dist/shared/assets/ and the game's entry
// carries none of it. The page itself (the index, the `&nav` bar, the `&live` binding, the boot)
// is the shared web/shared/ui/stories.ts since docs/design/dry-round-2.md I3 (Wave G3); this file
// keeps what is gin's: the catalogue, the slot hand view, the index's copy and what a live page
// does with an effect (docs/design/gin-arrangement-and-discards.md §11): the reducer's timers (the
// long press needs its `cardPress` timer, on the page's own clock) and its toasts (shown, never
// hidden) run, every other effect is dropped, so an intent that needs another effect (a persist,
// a send, a confirm) does nothing beyond its state change. e2e/gin-stories.spec.ts opens each story
// without either flag; e2e/gin-arrange.spec.ts uses `live`.
import type { PageLike } from '../../../../shared/edge/dom.ts';
import { mulberry32 } from '../../../../shared/lib/rng.ts';
import { bootStories, type StoriesDeps } from '../../../../shared/ui/stories.ts';
import { slotHandView } from '../ui/hand/SlotHandView.ts';
import { bindAll, paint, renderRules, showToast } from '../ui/render.ts';
import { reduce, type App, type Effect, type Intent, type TimerId } from '../ui/state.ts';
import { EPOCH, SEED, STORIES, storyById, type Story } from './catalogue.ts';

type Deps = StoriesDeps<App, Intent, Effect, Story>;

/** The index's heading and its note: the design row the catalogue follows. */
const COPY = {
  title: 'Gin Rummy stories',
  blurb:
    'Each link paints one catalogued table state (docs/design/gin-draw-ghost-slot.md §7) with the real paint; nothing is connected or saved.',
} as const;

/** Of the effects only the named timers and the toasts run; the rest are dropped (see the header). */
const liveEffects = (doc: PageLike): Deps['runEffect'] => {
  /* eslint-disable functional/immutable-data -- the armed timers, as main.ts keeps them */
  const timers = new Map<TimerId, ReturnType<typeof setTimeout>>();
  return (effect, dispatch) => {
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
  /* eslint-enable functional/immutable-data */
};

const deps = (doc: PageLike): Deps => ({
  stories: STORIES,
  storyById,
  // The hand is drawn by the slot view with the ghost draw slot, as main.ts draws it.
  paint: (d, app) => {
    paint(d, app, slotHandView);
  },
  bindAll,
  reduce,
  ctx: { rng: mulberry32(SEED), now: (): number => EPOCH },
  runEffect: liveEffects(doc),
});

/** Paint the story `id` names, or the index when it names none; `nav` adds the bar, `live` the controls. */
export const bootStory = (doc: PageLike, id: string, nav: boolean, live = false): void => {
  renderRules(doc);
  bootStories(doc, deps(doc), COPY).bootStory(id, nav, live);
};
