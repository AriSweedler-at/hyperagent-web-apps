import { describe, expect, test } from 'vitest';

import { JOIN_PARAM, inviteUrl, joinCodeFrom, withoutJoin } from './invite.ts';

// This test compiles under tsconfig.pure.json too (no DOM, no node types), so Node's real
// URLSearchParams, the oracle here, is reached through globalThis behind a structural type.
type SearchParams = Readonly<{
  get: (name: string) => string | null;
  delete: (name: string) => void;
  toString: () => string;
}>;
const { URLSearchParams } = globalThis as unknown as Readonly<{
  URLSearchParams: new (search: string) => SearchParams;
}>;

/** What gin's main.ts did before the helpers moved here, on Node's real URLSearchParams. */
const reference = (search: string): { join: string | null; rest: string } => {
  const params = new URLSearchParams(search);
  const join = params.get('join');
  params.delete('join');
  return { join, rest: params.toString() };
};

/** The harness's hook query (e2e/fixtures/player.ts `gameQuery`) with an invite appended, as the handoff spec opens the page. */
const HOOKS =
  'peer=127.0.0.1%3A9000&ice=http%3A%2F%2F127.0.0.1%3A4173%2Fhyperagent-web-apps%2Fe2e-ice.json';

const SEARCHES: ReadonlyArray<string> = [
  '',
  '?',
  '?join=KQZM',
  'join=KQZM',
  `?${HOOKS}&join=kqzm`,
  `?join=kqzm&${HOOKS}`,
  '?peer=127.0.0.1:9000&join=ABCD&ice-policy=relay',
  '?nav&join=AB+CD&live=',
  '?join',
  '?join=&x=1',
  '?a=%C3%A9%E2%82%AC%F0%9F%98%80&b=%2B%20%21%27%28%29%7E*-._~&join=x',
  "?q=!'()~ *-._&join=x",
  '?join=A&join=B&c=%zz',
  '?%6Aoin=X&y=%3D%26',
  '?a=b=c&join=d',
];

describe('inviteUrl', () => {
  test('is the page with the code to join, and nothing else', () => {
    expect(JOIN_PARAM).toBe('join');
    expect(inviteUrl('KQZM', 'https://games.sweedler.com/gin-rummy/')).toBe(
      'https://games.sweedler.com/gin-rummy/?join=KQZM',
    );
    expect(inviteUrl('a b&c', 'https://x/')).toBe('https://x/?join=a%20b%26c');
  });
});

describe('joinCodeFrom and withoutJoin reproduce URLSearchParams', () => {
  SEARCHES.forEach((search) => {
    test(JSON.stringify(search), () => {
      const { join, rest } = reference(search);
      expect(joinCodeFrom(search)).toBe(join);
      expect(withoutJoin(search)).toBe(rest);
    });
  });

  test('a percent-escape that is not UTF-8 stays raw instead of becoming U+FFFD (documented divergence)', () => {
    expect(withoutJoin('?a=%E0&join=x')).toBe('a=%25E0');
    expect(joinCodeFrom('?join=%E0%A4')).toBe('%E0%A4');
  });
});
