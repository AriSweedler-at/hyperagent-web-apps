import { describe, expect, test } from 'vitest';

import { joinCodeFrom, withoutJoin } from './invite.ts';

/** What gin's main.ts did inline before the readers moved here. */
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
  '?a=%E0&join=x',
];

describe('joinCodeFrom and withoutJoin', () => {
  SEARCHES.forEach((search) => {
    test(`${JSON.stringify(search)} reads and drops the join as the platform does`, () => {
      const { join, rest } = reference(search);
      expect(joinCodeFrom(search)).toBe(join);
      expect(withoutJoin(search)).toBe(rest);
    });
  });

  test('the code is the first join; the rest keeps its order and its escapes', () => {
    expect(joinCodeFrom('?peer=x&join=KQZM&join=ZZZZ')).toBe('KQZM');
    expect(withoutJoin('?peer=127.0.0.1:9000&join=KQZM&ice-policy=relay')).toBe(
      'peer=127.0.0.1%3A9000&ice-policy=relay',
    );
    expect(withoutJoin('?join=KQZM')).toBe('');
  });
});
