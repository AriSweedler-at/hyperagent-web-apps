// The rules tab on the fake DOM: the six panels, the five turn steps and the strategy list drawn
// from the registry.
import { expect, test } from 'vitest';

import { SHIPPED } from '../../bots/registry.ts';
import { all, byClass, requireId } from '../../../../../shared/edge/dom.fake.ts';
import { renderApp } from '../render.fake.ts';
import { SCENARIOS } from '../scenarios.ts';

test('rulesTab: panels, headings, steps and the shipped strategies', () => {
  const { root, intents } = renderApp(SCENARIOS.rules);
  const tab = requireId(root, 'tab-rules');
  const panels = byClass(tab, 'panel');
  expect(panels).toHaveLength(6);
  expect(panels[0]?.childNodes[0]?.textContent).toBe('How to play Fidice — Crowe house rules');
  expect(all(tab, (el) => el.tagName === 'H3').map((h) => h.textContent)).toEqual([
    'Setup',
    'Your turn',
    'Calling liar',
    'The ladder (hand rankings)',
    'Good to know',
  ]);
  const steps = byClass(tab, 'steps')[0];
  expect(steps?.tagName).toBe('OL');
  expect(steps?.childNodes.map((li) => li.textContent.split('.')[0])).toEqual([
    'Decide blind: call or accept',
    'Peek',
    'Pull dice out',
    'Roll (once)',
    'Bid',
  ]);
  const good = panels[5]?.textContent ?? '';
  SHIPPED.forEach((s) => {
    expect(good).toContain(`${s.name}: ${s.blurb.replace(/\.$/, '')}`);
  });
  expect(byClass(tab, 'ex')[0]?.textContent).toMatch(/^Example\. Andy opens with/);
  expect(all(tab, (el) => el.listenerTypes().length > 0)).toEqual([]);
  expect(intents()).toEqual([]);
});
