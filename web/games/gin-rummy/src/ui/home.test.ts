// No jsdom here (docs/ARCHITECTURE.md "Testing pyramid"): the home screen runs against the
// string-backed page fake (web/shared/edge/page.fake.ts), one element per id the page holds.
import { describe, expect, test } from 'vitest';

import { fakeEl, fakePage } from '../../../../shared/edge/page.fake.ts';
import { fillNameInputs, inviteText, setCodeInput } from './home.ts';

describe('the input writes the reducer raises as effects', () => {
  test('fillNameInputs writes both name inputs; setCodeInput the code field', () => {
    const page = fakePage([
      fakeEl('nameInput', { value: 'Ari' }),
      fakeEl('p1NameInput'),
      fakeEl('codeInput', { value: 'ab' }),
    ]);
    fillNameInputs(page.doc, 'Ann');
    expect(page.get('nameInput').value()).toBe('Ann');
    expect(page.get('p1NameInput').value()).toBe('Ann');
    setCodeInput(page.doc, 'AB');
    expect(page.get('codeInput').value()).toBe('AB');
  });
});

describe('inviteText', () => {
  test('is the legacy share text', () => {
    expect(inviteText('KQZM', 'https://games.sweedler.com/gin-rummy/')).toBe(
      'Join my Gin Rummy game — room code KQZM. Open https://games.sweedler.com/gin-rummy/ and tap Join.',
    );
  });
});
