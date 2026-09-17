// Keeps the harness off the public internet: the pages load PeerJS 1.5.4 from a CDN and Fidice
// pulls Google Fonts. The CDN request is answered with the identical bundle pinned in node_modules
// (same sha256 as the CDN copy) and the font stylesheet with an empty one. Nothing about the pages
// changes; only where two static files come from. The broker (0.peerjs.com) is never routed: the
// hermetic projects point it at the local PeerServer with ?peer=, and the `broker` CI job lets it
// through on purpose.
import { resolve } from 'node:path';

import type { BrowserContext } from '@playwright/test';

const PEERJS_BUNDLE = resolve(
  import.meta.dirname,
  '..',
  '..',
  'node_modules',
  'peerjs',
  'dist',
  'peerjs.min.js',
);
const PEERJS_CDN =
  /^https:\/\/(unpkg\.com|cdn\.jsdelivr\.net)\/(npm\/)?peerjs@1\.5\.4\/dist\/peerjs\.min\.js$/;
const GOOGLE_FONTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;

export const routeOffline = async (context: BrowserContext): Promise<void> => {
  await context.route(PEERJS_CDN, (route) =>
    route.fulfill({ path: PEERJS_BUNDLE, contentType: 'text/javascript' }),
  );
  await context.route(GOOGLE_FONTS, (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' }),
  );
};

/** Requests that may fail without failing a spec. Chromium asks for a favicon the pages do not ship. */
export const ALLOWED_FAILURES: ReadonlyArray<RegExp> = [/\/favicon\.ico$/];
