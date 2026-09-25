// The stories page (docs/design/briscola.md §5.6 "Stories"; docs/ARCHITECTURE.md "Documented test
// hooks"): `?story=<id>` on the briscola page paints one catalogued table state with the same
// `paint` main.ts uses, and nothing else happens: no store, no network, no ICE, no timers, no
// listeners. main.ts imports this module dynamically and only when the query names a story (the
// eight lines gin's main.ts spends before its boot), so the catalogue lands in its own chunk and
// the game's entry carries none of it. The page itself (the index, the `&nav` bar, the `&live`
// binding, the boot) is the shared web/shared/ui/stories.ts (dry-round-2.md I3, Wave G3); this
// file keeps what is briscola's: the catalogue, the suit sprite the glyph faces `<use>` (inlined
// once, as main.ts does), the index's copy and what a live page does with an effect: the reducer's
// timers (the settle beat needs its `settle` timer, on the page's own clock) and its toasts run,
// every other effect is dropped, so a flow can be driven from a catalogued state without a game,
// a store or a network. e2e/briscola-stories.spec.ts opens each story without either flag.
import { appendHtml, requireId, trustedHtml, type PageLike } from '../../../../shared/edge/dom.ts';
import { mulberry32 } from '../../../../shared/lib/rng.ts';
import { SUIT_SPRITE_SVG } from '../../../../shared/ui/cardFace.ts';
import { STORIES_IDS, bootStories, type StoriesDeps } from '../../../../shared/ui/stories.ts';
import { bindAll, paint, showToast } from '../ui/render.ts';
import { reduce, type App, type Effect, type Intent, type TimerId } from '../ui/state.ts';
import { EPOCH, SEED, STORIES, storyById, type Story } from './catalogue.ts';

type Deps = StoriesDeps<App, Intent, Effect, Story>;

/** The index's heading and its note: the design row the catalogue follows. */
const COPY = {
  title: 'Briscola stories',
  blurb:
    'Each link paints one catalogued table state (docs/design/briscola.md §5.6) with the real paint; nothing is connected or saved.',
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
  paint,
  bindAll,
  reduce,
  ctx: { rng: mulberry32(SEED), now: (): number => EPOCH },
  runEffect: liveEffects(doc),
});

/** Paint the story `id` names, or the index when it names none; `nav` adds the bar, `live` the controls. */
export const bootStory = (doc: PageLike, id: string, nav: boolean, live = false): void => {
  // The four Italian suit symbols the glyph faces and the trump badge `<use>`, once, before any
  // paint: a `<symbol>` is found anywhere in the document, so the sprite sits inside `#app`, the one
  // element this module reaches by id (main.ts puts it first on the body).
  appendHtml(requireId(doc, STORIES_IDS.app), trustedHtml(SUIT_SPRITE_SVG));
  bootStories(doc, deps(doc), COPY).bootStory(id, nav, live);
};
