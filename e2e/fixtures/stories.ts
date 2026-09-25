// A stories catalogue on the served page, once for every game that keeps one (docs/design/dry-round-2.md
// §3 I3, Wave G3; gin's e2e/gin-stories.spec.ts spelled it first, docs/ARCHITECTURE.md "Testing
// pyramid" 5). `storiesSpec` declares one test per story per viewport: the page's `?story=<id>` hook
// is opened and the game's table waited for (`settled`); the facts the game's catalogue derived
// from its engine are read from the DOM a player sees (`readFacts`) and compared (`expectFacts`);
// the game's geometry checks run (`geometry`); a story the owner asked to be stable (`stable.sameAs`)
// holds the same card at the same pixel rectangle as that story (`stable.rects`, a page script
// reading `data-card -> [x, y, w, h]`); and, at the viewports marked `shot`, a screenshot is
// compared against the committed per-platform baseline under the SPEC's name
// (`e2e/__screenshots__/<spec>/<id>--<viewport>-<platform>.png`: playwright.config.ts
// `snapshotPathTemplate` reads the file the runner loaded, so the fixture's call keeps the folder).
// A missing baseline fails: CI is never green with no visual coverage. A story with a sheet open
// (`sheetOpen`) shoots `body` at every viewport, since the overlays are siblings of `#app`, as does
// a viewport marked `body` (the phone). Every test runs once, on `pages`: both origins serve the
// same bytes. Re-recording: `npm run test:e2e -- <spec> --project pages --update-snapshots` on
// macOS, and the `stories-baselines.yml` workflow (its `spec` input) for linux.
import { expect, test, type Page } from '@playwright/test';

import type { Game } from '../../tools/games.ts';
import { ALLOWED_FAILURES } from './offline.ts';
import { pagePath } from './site.ts';
import { watchPage } from './watch.ts';

/** What the spec reads of a catalogued story; a game's `Story` holds more (its App, its facts). */
export type StoryLike = Readonly<{
  /** kebab-case, unique; the `?story=` value and the screenshot file's stem. */
  id: string;
  /** Compared against the committed per-platform baseline (false: DOM and geometry only). */
  screenshot: boolean;
}>;

export type StoryViewport = Readonly<{
  width: number;
  height: number;
  /** A screenshot here (false: geometry only). */
  shot: boolean;
  /** Shoot `body` rather than `#app`: the phone, whose overlays are siblings of `#app`. */
  body: boolean;
}>;

/** `data-card -> [x, y, w, h]` as `stable.rects` reads it. */
export type Rects = Readonly<Record<string, readonly [number, number, number, number]>>;

export type StoriesSpec<S extends StoryLike, V extends StoryViewport, F> = Readonly<{
  game: Game;
  stories: ReadonlyArray<S>;
  storyById: (id: string) => S | null;
  /** By name: each becomes a `describe` with that viewport; the name is the screenshot's suffix. */
  viewports: Readonly<Record<string, V>>;
  /** After `#tableScreen` is visible: the game's own wait for the table to be laid (gin: the slot count). */
  settled: (page: Page, story: S) => Promise<void>;
  /** The facts as the served DOM shows them, in the catalogue's terms. */
  readFacts: (page: Page) => Promise<F>;
  expectFacts: (facts: F, story: S) => void;
  /** The game's geometry checks at this viewport (gin: the hand grid, `#app` never scrolls). */
  geometry?: (page: Page, story: S, vp: V) => Promise<void>;
  /** The owner's stability sentence: the story whose first cards must sit at the same pixels, and the script reading them. */
  stable?: Readonly<{ sameAs: (story: S) => string | undefined; rects: string }>;
  /** A story with a sheet open shoots `body` at every viewport. */
  sheetOpen: (story: S) => boolean;
}>;

const near = (a: number, b: number): boolean => Math.abs(a - b) <= 0.5;

/** Every card of `then` sits in `now` at the same rectangle, to half a pixel. */
export const expectSameRects = (now: Rects, then: Rects, id: string): void => {
  expect(Object.keys(now).sort(), `${id}: the first ten cards`).toEqual(Object.keys(then).sort());
  Object.entries(then).forEach(([card, rect]) => {
    const here = now[card];
    expect(here, `${id}: card ${card}`).toBeDefined();
    if (here === undefined) return;
    rect.forEach((side, i) => {
      expect(
        near(here[i] ?? NaN, side),
        `${id}: card ${card} moved (${['x', 'y', 'w', 'h'][i] ?? ''})`,
      ).toBe(true);
    });
  });
};

/** One test per story per viewport, as the header describes; called at a spec's top level. */
export const storiesSpec = <S extends StoryLike, V extends StoryViewport, F>(
  spec: StoriesSpec<S, V, F>,
): void => {
  const openStory = async (page: Page, story: S): Promise<void> => {
    await page.goto(`${pagePath('pages', spec.game)}?story=${story.id}`);
    await expect(page.locator('#tableScreen')).toBeVisible();
    await spec.settled(page, story);
  };

  Object.entries(spec.viewports).forEach(([name, vp]) => {
    test.describe(name, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      spec.stories.forEach((story) => {
        test(story.id, async ({ page }, testInfo) => {
          test.skip(
            testInfo.project.name !== 'pages',
            'runs once: the stories are the same bytes on both origins',
          );
          const watched = watchPage(page, ALLOWED_FAILURES);
          await openStory(page, story);

          // The facts, the geometry, and the owner's sentence: the same card in the same place.
          spec.expectFacts(await spec.readFacts(page), story);
          await spec.geometry?.(page, story, vp);
          const sameAs = spec.stable?.sameAs(story);
          if (spec.stable !== undefined && sameAs !== undefined) {
            const other = spec.storyById(sameAs);
            expect(other, sameAs).not.toBeNull();
            if (other !== null) {
              const mine = await page.evaluate<Rects>(spec.stable.rects);
              await openStory(page, other);
              expectSameRects(mine, await page.evaluate<Rects>(spec.stable.rects), story.id);
              await openStory(page, story);
            }
          }

          if (vp.shot && story.screenshot) {
            const target = vp.body || spec.sheetOpen(story) ? 'body' : '#app';
            await expect(page.locator(target)).toHaveScreenshot(`${story.id}--${name}.png`, {
              animations: 'disabled',
              caret: 'hide',
              maxDiffPixelRatio: 0.002,
            });
          }
          expect(watched.errors(), 'uncaught exceptions').toEqual([]);
          expect(watched.failures(), 'failed requests').toEqual([]);
        });
      });
    });
  });
};
