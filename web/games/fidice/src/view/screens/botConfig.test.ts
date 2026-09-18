// The bot configuration screen on the fake DOM: the current choice, the quick pick, one card per
// strategy (aria-pressed), the self-taught card whose generation buttons do not also pick the
// card, and done.
import { describe, expect, test } from 'vitest';

import { CHECKPOINTS } from '../../bots/strategies/learnerWeights.ts';
import { DIFFICULTIES, RANDOM_STRATEGY, SHIPPED, choiceLabel } from '../../bots/registry.ts';
import { byClass, fire, hasClass, requireId } from '../../../../../shared/edge/dom.fake.ts';
import { renderApp } from '../render.fake.ts';
import { LEARNER_GENERATION, SCENARIOS } from '../scenarios.ts';

const lastGeneration = CHECKPOINTS[CHECKPOINTS.length - 1]?.generation ?? 0;

describe('configScreen', () => {
  test('the solo form: heading, current choice, quick pick, strategy cards, done', () => {
    const { root, intents } = renderApp(SCENARIOS['config: the solo form']);
    requireId(root, 'screen-config');
    expect(byClass(root, 'panel')[0]?.childNodes[0]?.textContent).toContain(
      'Configure the computers',
    );
    expect(requireId(root, 'cfgCurrent').textContent).toBe(`Playing: ${choiceLabel('profiler')}`);
    const quick = DIFFICULTIES.map((d) => requireId(root, `cfg-${d.id}`));
    expect(quick.map((b) => hasClass(b, 'on'))).toEqual(
      DIFFICULTIES.map((d) => d.strategy.id === 'profiler'),
    );
    const cards = SHIPPED.map((s) => requireId(root, `cfg-${s.id}`));
    expect(cards.map((c) => c.getAttribute('aria-pressed'))).toEqual(
      SHIPPED.map((s) => String(s.id === 'profiler')),
    );
    expect(cards.map((c) => byClass(c, 'cfg-name')[0]?.textContent)).toEqual(
      SHIPPED.map((s) => s.name),
    );
    expect(cards.every((c) => byClass(c, 'cfg-tag').length === 1)).toBe(true);
    const learner = requireId(root, 'cfg-learner');
    expect(learner.getAttribute('aria-pressed')).toBe('false');
    const random = requireId(root, `cfg-${RANDOM_STRATEGY}`);
    expect(random.getAttribute('aria-pressed')).toBe('false');
    if (quick[0]) fire(quick[0], 'click');
    if (cards[0]) fire(cards[0], 'click');
    fire(random, 'click');
    fire(requireId(root, 'btnConfigDone'), 'click');
    expect(intents()).toEqual([
      { type: 'config.pick', choice: DIFFICULTIES[0].strategy.id },
      { type: 'config.pick', choice: SHIPPED[0].id },
      { type: 'config.pick', choice: RANDOM_STRATEGY },
      { type: 'config.close' },
    ]);
  });

  test('the self-taught card: generations, the last one shown, a generation click does not bubble', () => {
    const { root, intents } = renderApp(SCENARIOS['config: the solo form']);
    const learner = requireId(root, 'cfg-learner');
    const gens = CHECKPOINTS.map((c) => requireId(root, `cfg-learner-${String(c.generation)}`));
    expect(gens.map((g) => hasClass(g, 'on'))).toEqual(
      CHECKPOINTS.map((c) => c.generation === lastGeneration),
    );
    expect(learner.textContent).toContain(`at generation ${String(lastGeneration)}.`);
    const event = gens[0] && fire(gens[0], 'click');
    expect(event?.propagationStopped()).toBe(true);
    fire(learner, 'click');
    expect(intents()).toEqual([
      { type: 'config.pick', choice: `learner-${String(CHECKPOINTS[0]?.generation ?? 0)}` },
      { type: 'config.pick', choice: `learner-${String(lastGeneration)}` },
    ]);
  });

  test('a seated computer: its name in the heading and its current strategy on', () => {
    const ui = SCENARIOS['config: a seated computer'];
    const { root } = renderApp(ui);
    expect(byClass(root, 'panel')[0]?.childNodes[0]?.textContent).toContain(
      `Configure ${ui.game?.players[3]?.name ?? ''}`,
    );
    // A bot drawn at random shows the random card as current.
    expect(requireId(root, 'cfgCurrent').textContent).toBe(
      `Playing: ${choiceLabel(RANDOM_STRATEGY)}`,
    );
    expect(requireId(root, `cfg-${RANDOM_STRATEGY}`).getAttribute('aria-pressed')).toBe('true');
    // No difficulty preset draws at random, so the quick pick has nothing on.
    expect(DIFFICULTIES.some((d) => hasClass(requireId(root, `cfg-${d.id}`), 'on'))).toBe(false);
    expect(
      byClass(root, 'small').some((s) => s.textContent === 'A custom choice is selected below.'),
    ).toBe(true);
  });

  test('a self-taught computer: the learner card and its generation on', () => {
    const { root } = renderApp(SCENARIOS['config: a self-taught computer']);
    expect(requireId(root, 'cfg-learner').getAttribute('aria-pressed')).toBe('true');
    expect(hasClass(requireId(root, `cfg-learner-${String(LEARNER_GENERATION)}`), 'on')).toBe(true);
    expect(requireId(root, 'cfgCurrent').textContent).toBe(
      `Playing: ${choiceLabel(`learner-${String(LEARNER_GENERATION)}`)}`,
    );
  });
});
