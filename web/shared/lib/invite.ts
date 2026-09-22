// The invite link every game shares (docs/ARCHITECTURE.md "Documented test hooks": `?join=<code>`):
// the page's origin and path with the code to join and nothing else, and how a page's boot reads
// the code back out of `location.search` and drops it from the address bar while keeping the other
// parameters (`?peer=`, `?ice=`). The two readers reproduce `URLSearchParams` (parse, `get`,
// `delete`, `toString`), which gin's main.ts used until the helpers moved here: this layer compiles
// without the DOM lib, so the class is unnameable, and the rewritten URL must stay byte for byte what
// it was (e2e/gin-handoff.spec.ts compares it with the harness's own `URLSearchParams` query).
// web/shared/lib/invite.test.ts checks the readers against Node's `URLSearchParams` directly.

export const JOIN_PARAM = 'join';

/** The link `#shareCodeBtn` shares: the page (`pageUrl` is its origin and path) with the code to join. */
export const inviteUrl = (code: string, pageUrl: string): string =>
  `${pageUrl}?${JOIN_PARAM}=${encodeURIComponent(code)}`;

/**
 * One percent-escaped, well-formed UTF-8 sequence (RFC 3629 §4: no overlongs, no surrogates,
 * nothing past U+10FFFF), which is exactly what `decodeURIComponent` accepts without throwing. Every
 * other `%` stays as it is, as the WHATWG percent-decoder leaves a `%` that no two hex digits follow.
 * (An escape that is two hex digits but not valid UTF-8, `%E0` alone, would become U+FFFD there;
 * here it stays raw. No browser writes one into `location.search`.)
 */
const UTF8_ESCAPE =
  /%[0-7][\da-f]|%c[2-9a-f]%[89ab][\da-f]|%d[\da-f]%[89ab][\da-f]|%e0%[ab][\da-f]%[89ab][\da-f]|%e[1-9a-cef]%[89ab][\da-f]%[89ab][\da-f]|%ed%[89][\da-f]%[89ab][\da-f]|%f0%[9ab][\da-f]%[89ab][\da-f]%[89ab][\da-f]|%f[1-3]%[89ab][\da-f]%[89ab][\da-f]%[89ab][\da-f]|%f4%8[\da-f]%[89ab][\da-f]%[89ab][\da-f]/gi;

/** `application/x-www-form-urlencoded` decoding: `+` is a space, then the percent-escapes. */
const decode = (token: string): string =>
  token.replace(/\+/g, ' ').replace(UTF8_ESCAPE, (escape) => decodeURIComponent(escape));

/**
 * `application/x-www-form-urlencoded` encoding: `encodeURIComponent`'s set plus the five characters
 * that serializer escapes too (`!'()~`), and a space as `+`.
 */
const encode = (text: string): string =>
  encodeURIComponent(text)
    .replace(/[!'()~]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, '+');

type Pair = Readonly<{ name: string; value: string }>;

/** The name=value pairs of a search string, decoded; a lone name has the empty value, as in the URL standard. */
const pairs = (search: string): ReadonlyArray<Pair> =>
  (search.startsWith('?') ? search.slice(1) : search)
    .split('&')
    .filter((sequence) => sequence !== '')
    .map((sequence) => {
      const at = sequence.indexOf('=');
      return at === -1
        ? { name: decode(sequence), value: '' }
        : { name: decode(sequence.slice(0, at)), value: decode(sequence.slice(at + 1)) };
    });

/** The invite's code (`new URLSearchParams(search).get('join')`), or null when the link carries none. */
export const joinCodeFrom = (search: string): string | null =>
  pairs(search).find(({ name }) => name === JOIN_PARAM)?.value ?? null;

/**
 * The search string with every `join` dropped and the rest re-serialised as `URLSearchParams` would
 * (`params.delete('join'); params.toString()`): no leading `?`, and '' when nothing is left.
 */
export const withoutJoin = (search: string): string =>
  pairs(search)
    .filter(({ name }) => name !== JOIN_PARAM)
    .map(({ name, value }) => `${encode(name)}=${encode(value)}`)
    .join('&');
