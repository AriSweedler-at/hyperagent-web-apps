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
    expect(p.get('curtainBtn').attr('data-rolls')).toBeNull();
    paintCurtain(p.doc, null);
    expect(p.get('curtainOverlay').hidden()).toBe(true);
    expect(p.get('curtainTitle').text()).toBe('Pass the phone to Bob');
  });

  test('attrs land on the button: a string sets, null removes', () => {
    const p = page();
    paintCurtain(p.doc, { ...TEXT, button: 'Bob — roll', attrs: { 'data-rolls': '1' } });
    expect(p.get('curtainBtn').text()).toBe('Bob — roll');
    expect(p.get('curtainBtn').attr('data-rolls')).toBe('1');
    paintCurtain(p.doc, { ...TEXT, button: 'Bob — your turn', attrs: { 'data-rolls': null } });
    expect(p.get('curtainBtn').attr('data-rolls')).toBeNull();
  });
});

describe('bindCurtain', () => {
  test('one tap dispatches what onReveal reads off the button, in order, at that moment', () => {
    const p = page();
    const intents: string[] = [];
    bindCurtain(
      p.doc,
      (i: string) => {
        intents.push(i);
      },
      (btn) => (btn.getAttribute('data-rolls') === '1' ? ['reveal', 'roll'] : ['reveal']),
    );
    p.get('curtainBtn').fire('click');
    expect(intents).toEqual(['reveal']);
    p.get('curtainBtn').el.setAttribute('data-rolls', '1');
    p.get('curtainBtn').fire('click');
    expect(intents).toEqual(['reveal', 'reveal', 'roll']);
  });
});
