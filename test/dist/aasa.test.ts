// The Dice App Clip's site half (docs/design/ui-sandbox.md §7; ios/DiceClip/README.md steps 6 and
// 7): Apple's app-site association file and the Smart App Banner turn on together with the owner's
// two ids (web/shared/lib/appClip.ts `isConfigured`). Unconfigured, the tree holds no AASA (Apple
// would read a placeholder team id) and the sandbox page carries no banner. Configured, the file is
// at its well-known path, parses, and is byte for byte the module's document, so the team id the
// owner typed is the one the site serves. Runs on dist/ after the build (npm run test:site).
import { expect, test } from 'vitest';

import {
  AASA_PATH,
  CLIP_BUNDLE_ID,
  CLIP_PATHS,
  type ClipExperience,
  SMART_APP_BANNER_META,
  TEAM_ID,
  appSiteAssociation,
  bannerContent,
  clipUrl,
  isConfigured,
} from '../../web/shared/lib/appClip.ts';
import { describeDist, distHasFile, readDist } from './dist.ts';

/** The file's path in the tree: the URL path less its leading slash. */
const AASA_FILE = AASA_PATH.slice(1);

/** The two experiences, each with a landing page of its own in the tree (web/public/clip/<name>/). */
const EXPERIENCES: ReadonlyArray<ClipExperience> = ['dice', 'rps'];
/** An experience's page in the tree: its URL path less the slash, then the folder's page. */
const clipPage = (experience: ClipExperience): string =>
  `${CLIP_PATHS[experience].slice(1)}/index.html`;
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * The banner tag as the page must carry it once configured: the meta's name and its exact
 * `content`, in Prettier's self-closing form, whatever line breaks Prettier puts between the
 * attributes (the content is longer than a line).
 */
const bannerTag = (experience: ClipExperience): RegExp | null => {
  const content = bannerContent(clipUrl(experience));
  return content === null
    ? null
    : new RegExp(
        `<meta\\s+name="${SMART_APP_BANNER_META}"\\s+content="${escapeRegExp(content)}"\\s*/>`,
      );
};
const BANNER_OPENING = new RegExp(`<meta\\s+name="${SMART_APP_BANNER_META}"`);

describeDist('the Dice App Clip: the AASA and the banner', (root) => {
  test('.nojekyll is in the tree, so GitHub Pages serves the dot-directory the AASA lives in', () => {
    expect(distHasFile(root, '.nojekyll')).toBe(true);
  });

  test(
    isConfigured()
      ? 'configured: the AASA is at its well-known path, parses, and names the clip under the team id'
      : 'unconfigured: no AASA in the tree, so Apple never reads a placeholder team id',
    () => {
      const document = appSiteAssociation();
      if (document === null) {
        expect(distHasFile(root, AASA_FILE)).toBe(false);
        return;
      }
      expect(distHasFile(root, AASA_FILE), `write web/public/${AASA_FILE}`).toBe(true);
      const parsed: unknown = JSON.parse(readDist(root, AASA_FILE));
      expect(parsed).toEqual(document);
      expect(document.appclips.apps).toEqual([`${TEAM_ID}.${CLIP_BUNDLE_ID}`]);
    },
  );

  test('the sandbox page ships no static Smart App Banner: the boot emits one once configured', () => {
    expect(readDist(root, 'games/ui-sandbox/index.html')).not.toContain(SMART_APP_BANNER_META);
  });

  // The invocation URLs land on a page each (infra/games-proxy/worker.ts CLIP_PREFIX serves them):
  // static HTML with no build step, so the banner is pasted by hand over a placeholder comment once
  // the ids are filled, and these rows demand the paste then, byte for byte.
  test('EXPERIENCES is every CLIP_PATHS key', () => {
    expect(Object.keys(CLIP_PATHS)).toEqual(EXPERIENCES);
  });

  EXPERIENCES.forEach((experience) => {
    test(`${CLIP_PATHS[experience]} lands on a page of the tree's own, with a title`, () => {
      expect(distHasFile(root, clipPage(experience)), `web/public/${clipPage(experience)}`).toBe(
        true,
      );
      expect(readDist(root, clipPage(experience))).toMatch(/<title>[^<]+<\/title>/);
    });

    test(
      isConfigured()
        ? `configured: the ${experience} page carries the Smart App Banner for its invocation URL`
        : `unconfigured: the ${experience} page carries no Smart App Banner, only its placeholder comment`,
      () => {
        const html = readDist(root, clipPage(experience));
        const tag = bannerTag(experience);
        if (tag === null) {
          expect(html).not.toMatch(BANNER_OPENING);
          return;
        }
        expect(
          html,
          `paste the banner over the placeholder in web/public/${clipPage(experience)}`,
        ).toMatch(tag);
      },
    );
  });
});
