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
  SMART_APP_BANNER_META,
  TEAM_ID,
  appSiteAssociation,
  isConfigured,
} from '../../web/shared/lib/appClip.ts';
import { describeDist, distHasFile, readDist } from './dist.ts';

/** The file's path in the tree: the URL path less its leading slash. */
const AASA_FILE = AASA_PATH.slice(1);

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
});
