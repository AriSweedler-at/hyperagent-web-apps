// The invite link every game shares (docs/ARCHITECTURE.md "Documented test hooks": `?join=<code>`):
// the page's origin and path with the code to join and nothing else. A page's boot reads the code
// back out of `location.search` and drops it from the address bar with web/shared/edge/invite.ts,
// which needs the platform's `URLSearchParams`; this layer compiles without the DOM lib.

export const JOIN_PARAM = 'join';

/** The link `#shareCodeBtn` shares: the page (`pageUrl` is its origin and path) with the code to join. */
export const inviteUrl = (code: string, pageUrl: string): string =>
  `${pageUrl}?${JOIN_PARAM}=${encodeURIComponent(code)}`;
