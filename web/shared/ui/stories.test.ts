// The stories page over a FAKE page (web/shared/edge/page.fake.ts) and a three-story fake catalogue
// (docs/design/dry-round-2.md §6 `ui/stories.ts`): the index lists every story, a missing id is
// named, the bar has no prev on the first story and no next on the last, a live page repaints only
// when the App changed and hands every effect to the game's runner, and `bootStory` writes the
// index into `#app`, paints a story, and adds the bar and the controls only when asked.
import { describe, expect, test } from 'vitest';

import { fakeEl, fakePage } from '../edge/page.fake.ts';
import { bootStories, STORIES_IDS, STORY_QUERY, type StoriesDeps } from './stories.ts';

type App = Readonly<{ n: number }>;
type Intent = Readonly<{ type: 'bump' | 'noop' }>;
type Effect =
  | Readonly<{ type: 'toast'; message: string }>
  | Readonly<{ type: 'startTimer'; id: string; ms: number; then: Intent }>
  | Readonly<{ type: 'persist' }>;
type Story = Readonly<{ id: string; title: string; app: App; screenshot: boolean; extra: number }>;

const STORIES: ReadonlyArray<Story> = [
  { id: 'first', title: 'The first', app: { n: 1 }, screenshot: true, extra: 0 },
  { id: 'mid dle', title: 'A <middle> one', app: { n: 2 }, screenshot: false, extra: 0 },
  { id: 'last', title: 'The last', app: { n: 3 }, screenshot: true, extra: 0 },
];

const [first, middle, last] = STORIES as readonly [Story, Story, Story];

const COPY = { title: 'Fake stories', blurb: 'One line under the heading.' };

type Harness = Readonly<{
  page: ReturnType<typeof fakePage>;
  paints: ReadonlyArray<App>;
  effects: ReadonlyArray<Effect>;
  dispatch: () => (intent: Intent) => void;
  stories: ReturnType<typeof bootStories<App, Intent, Effect, Story>>;
}>;

/** The page, the game's fakes recording what they were handed, and the module over both. */
const harness = (): Harness => {
  const page = fakePage([fakeEl(STORIES_IDS.app)]);
  const paints: App[] = [];
  const effects: Effect[] = [];
  const bound: ((intent: Intent) => void)[] = [];
  // `bump` steps the App and raises a toast and a timer; `noop` returns the same App.
  const deps: StoriesDeps<App, Intent, Effect, Story> = {
    stories: STORIES,
    storyById: (id) => STORIES.find((s) => s.id === id) ?? null,
    paint: (_doc, app) => {
      paints.push(app);
    },
    bindAll: (_doc, dispatch) => {
      bound.push(dispatch);
    },
    reduce: (app, intent) =>
      intent.type === 'noop'
        ? { app, effects: [{ type: 'persist' }] }
        : {
            app: { n: app.n + 1 },
            effects: [
              { type: 'toast', message: `n=${String(app.n + 1)}` },
              { type: 'startTimer', id: 'press', ms: 300, then: { type: 'noop' } },
            ],
          },
    ctx: { rng: () => 0.5, now: () => 0 },
    runEffect: (effect) => {
      effects.push(effect);
    },
  };
  const stories = bootStories(page.doc, deps, COPY);
  return {
    page,
    paints,
    effects,
    dispatch: () => {
      const dispatch = bound[0];
      if (dispatch === undefined) throw new Error('bindAll was not called');
      return dispatch;
    },
    stories,
  };
};

describe('indexHtml', () => {
  test('lists every story as a link into the navigable view, with its title escaped and the screenshot note', () => {
    const html = harness().stories.indexHtml('');
    expect(html).toContain(`<h1 style="margin:0 0 12px;">${COPY.title}</h1>`);
    expect(html).toContain(`<p style="color:#9cc9ac;">${COPY.blurb}</p>`);
    expect(html).not.toContain('No story named');
    STORIES.forEach((s) => {
      expect(html).toContain(
        `href="?${STORY_QUERY.story}=${encodeURIComponent(s.id)}&${STORY_QUERY.nav}"`,
      );
    });
    expect(html).toContain('>first</a><span style="color:#9cc9ac;"> — The first</span>');
    expect(html).toContain(' — A &lt;middle&gt; one (no screenshot)</span>');
    expect(html).toContain(' — The last</span>');
  });

  test('names the id that matched no story, escaped', () => {
    const html = harness().stories.indexHtml('<nope>');
    expect(html).toContain(
      '<p style="color:#f87171;">No story named <code>&lt;nope&gt;</code>.</p>',
    );
  });
});

describe('navHtml', () => {
  test('the first story has no prev link, the last no next link, and the count sits between', () => {
    const { stories } = harness();
    const onFirst = stories.navHtml(first);
    expect(onFirst).toContain(`<div id="${STORIES_IDS.nav}" style="position:fixed;`);
    expect(onFirst).toContain('<span style="color:#9cc9ac;">← prev</span>');
    expect(onFirst).toContain(`<a href="?story=mid%20dle&nav" style=`);
    expect(onFirst).toContain('· 1/3 · first</span>');
    const onLast = stories.navHtml(last);
    expect(onLast).toContain('<span style="color:#9cc9ac;">next →</span>');
    expect(onLast).toContain(`<a href="?story=mid%20dle&nav" style=`);
    expect(onLast).toContain('· 3/3 · last</span>');
  });

  test('a middle story links both ways and the index link drops the flag', () => {
    const html = harness().stories.navHtml(middle);
    expect(html).toContain('href="?story=first&nav"');
    expect(html).toContain('href="?story=last&nav"');
    expect(html).toContain('<a href="?story=" style=');
    expect(html).toContain('· 2/3 · mid dle</span>');
  });
});

describe('bindLive', () => {
  test('binds the controls once, repaints only when the App changed, and hands every effect to the runner', () => {
    const h = harness();
    h.stories.bindLive({ n: 1 });
    expect(h.paints).toEqual([]);
    const dispatch = h.dispatch();
    dispatch({ type: 'noop' });
    expect(h.paints, 'an unchanged App is not repainted').toEqual([]);
    expect(h.effects).toEqual([{ type: 'persist' }]);
    dispatch({ type: 'bump' });
    expect(h.paints).toEqual([{ n: 2 }]);
    expect(h.effects.slice(1)).toEqual([
      { type: 'toast', message: 'n=2' },
      { type: 'startTimer', id: 'press', ms: 300, then: { type: 'noop' } },
    ]);
    dispatch({ type: 'bump' });
    expect(h.paints, 'the next intent reduces the App the last one left').toEqual([
      { n: 2 },
      { n: 3 },
    ]);
  });
});

describe('bootStory', () => {
  test('an id naming no story writes the index into #app and paints nothing', () => {
    const h = harness();
    h.stories.bootStory('nope', true, true);
    expect(h.page.get(STORIES_IDS.app).text()).toBe(h.stories.indexHtml('nope'));
    expect(h.paints).toEqual([]);
    expect(h.page.body.text()).toBe('');
  });

  test('a story is painted; the bar and the controls come only with their flags', () => {
    const quiet = harness();
    quiet.stories.bootStory('first', false);
    expect(quiet.paints).toEqual([{ n: 1 }]);
    expect(quiet.page.body.text()).toBe('');
    expect(quiet.page.get(STORIES_IDS.app).text()).toBe('');
    expect(() => quiet.dispatch()).toThrow('bindAll was not called');

    const full = harness();
    full.stories.bootStory('last', true, true);
    expect(full.paints).toEqual([{ n: 3 }]);
    expect(full.page.body.text()).toBe(full.stories.navHtml(last));
    full.dispatch()({ type: 'bump' });
    expect(full.paints).toEqual([{ n: 3 }, { n: 4 }]);
  });
});
