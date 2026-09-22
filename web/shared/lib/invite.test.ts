import { describe, expect, test } from 'vitest';

import { JOIN_PARAM, inviteUrl } from './invite.ts';

describe('inviteUrl', () => {
  test('is the page with the code to join, and nothing else', () => {
    expect(JOIN_PARAM).toBe('join');
    expect(inviteUrl('KQZM', 'https://games.sweedler.com/gin-rummy/')).toBe(
      'https://games.sweedler.com/gin-rummy/?join=KQZM',
    );
    expect(inviteUrl('a b&c', 'https://x/')).toBe('https://x/?join=a%20b%26c');
  });
});
