import { describe, expect, test } from 'vitest';

import { fakeEl, fakePage, type FakePage } from '../edge/page.fake.ts';
import { bindCurtain, paintCurtain, type CurtainText } from './curtain.ts';

const page = (): FakePage =>
  fakePage([
    fakeEl('curtainOverlay', { classes: ['overlay', 'hidden'] }),
    fakeEl('curtainTitle', { text: 'Pass the phone' }),
    fakeEl('curtainSub'),
    fakeEl('curtainLast'),
    fakeEl('curtainBtn', { text: 'Show my cards' }),
  ]);

const TEXT: CurtainText = {
  title: 'Pass the phone to Bob',
  sub: 'Ann, look away 👀',
  last: 'Ann passed on the upcard.',
  button: "I'm Bob — show my cards",
};

describe('paintCurtain', () => {
  test('shows the curtain with its texts; hides it, texts untouched, for null', () => {
    const p = page();
    paintCurtain(p.doc, TEXT);
    expect(p.get('curtainOverlay').hidden()).toBe(false);
    expect(p.get('curtainTitle').text()).toBe('Pass the phone to Bob');
    expect(p.get('curtainSub').text()).toBe('Ann, look away 👀');
    expect(p.get('curtainLast').text()).toBe('Ann passed on the upcard.');
    expect(p.get('curtainBtn').text()).toBe("I'm Bob — show my cards");
    paintCurtain(p.doc, null);
    expect(p.get('curtainOverlay').hidden()).toBe(true);
    expect(p.get('curtainTitle').text()).toBe('Pass the phone to Bob');
  });
});

describe('bindCurtain', () => {
  test('one tap dispatches what onReveal returns, in order, at that moment', () => {
    const p = page();
    const intents: string[] = [];
    bindCurtain(
      p.doc,
      (i: string) => {
        intents.push(i);
      },
      // Asked at each tap, not at bind time: the second tap sees the first's intent dispatched.
      () => (intents.length === 0 ? ['reveal'] : ['reveal', 'roll']),
    );
    p.get('curtainBtn').fire('click');
    expect(intents).toEqual(['reveal']);
    p.get('curtainBtn').fire('click');
    expect(intents).toEqual(['reveal', 'reveal', 'roll']);
  });
});
