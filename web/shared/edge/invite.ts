// Reading the invite (`?join=<code>`, built by web/shared/lib/invite.ts) out of a page's
// `location.search` with the platform's `URLSearchParams`, so the address bar is rewritten byte for
// byte as the browser itself serialises the hooks that stay (`?peer=`, `?ice=`). An edge, like the
// rest of this folder, because `URLSearchParams` is a Web API the pure layer cannot name; every
// game's boot (web/games/gin-rummy/main.ts) calls the two readers once, before `home/init` settles.
import { JOIN_PARAM } from '../lib/invite.ts';

/** The invite's code (`new URLSearchParams(search).get('join')`), or null when the link carries none. */
export const joinCodeFrom = (search: string): string | null =>
  new URLSearchParams(search).get(JOIN_PARAM);

/** The search minus every `join`, as `URLSearchParams` serialises the rest: no leading `?`, '' when nothing is left. */
export const withoutJoin = (search: string): string => {
  const rest = new URLSearchParams(search);
  rest.delete(JOIN_PARAM);
  return rest.toString();
};
