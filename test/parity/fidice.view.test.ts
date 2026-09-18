// The view oracle (docs/MIGRATION.md step 9): the typed view/** and the legacy view code render
// the same states to the same DOM and their handlers dispatch the same intents. The legacy leg is
// the page's own `src/view/*` bundle sections, evaluated here in bundle order with their free
// identifiers bound to the sha256-pinned legacy core (test/fixtures/legacy/fidice-core.cjs) and to
// the sections before them, so it is the code the live page ran, not a re-typing of it. Both legs
// mount into web/shared/edge/dom.fake.ts; the trees are compared as `serialize` prints them
// (attributes, form properties, listener types, text), then every listener of every element is
// fired the same way on both and the dispatched intents, preventDefault and stopPropagation are
// compared in order. The states are the shared catalogue in web/games/fidice/src/view/scenarios.ts.
import vm from 'node:vm';

import { describe, expect, test } from 'vitest';

import { FIDICE_PAGE, debundleFidice } from '../../tools/legacy/debundle-fidice.ts';
import { readRepoFile } from '../../tools/legacy/extract.ts';
import {
  SCENARIOS,
  SCENARIO_NAMES,
  SHARE_BASE,
} from '../../web/games/fidice/src/view/scenarios.ts';
import type { Intent, Ui } from '../../web/games/fidice/src/view/types.ts';
import {
  all,
  fakeDocument,
  fire,
  serialize,
  type FakeElement,
} from '../../web/shared/edge/dom.fake.ts';
import { importFidiceModule, loadLegacyFidice } from './fidice.api.ts';

type Bindings = Readonly<Record<string, unknown>>;
type AppView = (ui: Ui, dispatch: (intent: Intent) => void) => unknown;
type Mount = (doc: unknown, root: unknown, tree: unknown) => void;
type Leg = Readonly<{
  appView: AppView;
  mount: Mount;
  initialUi: (base: string, name: string) => Ui;
}>;

const page = readRepoFile(FIDICE_PAGE);
const legacyCore = loadLegacyFidice() as unknown as Bindings;

/** The `src/view/*` sections of the legacy bundle, evaluated in order over the legacy core. */
const loadLegacyView = (): Bindings => {
  const { modules } = debundleFidice(page);
  const views = modules.filter((m) => m.section.name.startsWith('src/view/'));
  expect(views.map((m) => m.section.name)).toEqual([
    'src/view/vdom',
    'src/view/components',
    'src/view/screens/menu',
    'src/view/ui',
    'src/view/screens/lobby',
    'src/view/screens/table',
    'src/view/screens/ladder',
    'src/view/screens/spectator',
    'src/view/screens/rules',
    'src/view/screens/botConfig',
    'src/view/app',
  ]);
  return views.reduce<Bindings>((scope, m) => {
    const names = m.imports.flatMap((imp) => imp.names);
    const args = names.map((name) => {
      if (name in scope) return scope[name];
      if (name in legacyCore) return legacyCore[name];
      throw new Error(`${m.section.name}: ${name} is neither a view nor a legacy core binding`);
    });
    const source = `(function (${names.join(', ')}) {\n${m.section.body.join('\n')}\nreturn { ${m.exports.join(', ')} };\n})`;
    const factory = vm.runInThisContext(source, {
      filename: `${FIDICE_PAGE}#${m.section.name}`,
    }) as (...args: ReadonlyArray<unknown>) => Bindings;
    return { ...scope, ...factory(...args) };
  }, {});
};

const legFrom = (bindings: Bindings): Leg => ({
  appView: bindings['appView'] as AppView,
  mount: bindings['mount'] as Mount,
  initialUi: bindings['initialUi'] as Leg['initialUi'],
});

const legacy: Leg = legFrom(loadLegacyView());
const typed: Leg = legFrom({
  ...(await importFidiceModule('src/view/app.ts')),
  ...(await importFidiceModule('src/view/vdom.ts')),
  ...(await importFidiceModule('src/view/ui.ts')),
});

type Fired = Readonly<{
  element: number;
  tag: string;
  id: string | null;
  type: string;
  key: string;
  prevented: boolean;
  stopped: boolean;
  intents: ReadonlyArray<Intent>;
}>;

type Rendered = Readonly<{ tree: string; fired: ReadonlyArray<Fired> }>;

const KEYS: ReadonlyArray<string> = ['Enter', 'ArrowDown', 'ArrowUp', 'Escape', 'x'];

/** Fire one event of `type` on `el` in the way a user would produce it, and say what it did. */
const fireOne = (
  el: FakeElement,
  element: number,
  type: string,
  key: string,
  intents: Intent[],
): Fired => {
  const before = intents.length;
  const init =
    type === 'input'
      ? { value: `${el.value ?? ''}3s` }
      : type === 'change'
        ? el.getAttribute('type') === 'checkbox'
          ? { checked: !(el.checked ?? false) }
          : { value: '2' }
        : { key };
  const event = fire(el, type, init);
  return {
    element,
    tag: el.tagName,
    id: el.getAttribute('id'),
    type,
    key,
    prevented: event.defaultPrevented(),
    stopped: event.propagationStopped(),
    intents: intents.slice(before),
  };
};

/** Render `ui` through a leg into a fresh fake document, then exercise every listener. */
const render = (leg: Leg, ui: Ui): Rendered => {
  const doc = fakeDocument();
  const root = doc.createElement('div');
  const intents: Intent[] = [];
  leg.mount(
    doc,
    root,
    leg.appView(ui, (intent) => {
      intents.push(intent);
    }),
  );
  const tree = root.childNodes.map(serialize).join('');
  const fired = all(root)
    .map((el, element) => ({ el, element }))
    .filter(({ el }) => el.listenerTypes().length > 0)
    .flatMap(({ el, element }) =>
      el
        .listenerTypes()
        .flatMap((type) =>
          type === 'keydown'
            ? KEYS.map((key) => fireOne(el, element, type, key, intents))
            : [fireOne(el, element, type, '', intents)],
        ),
    );
  return { tree, fired };
};

describe('the typed view against the legacy view sections', () => {
  test('initialUi is the same record', () => {
    expect(typed.initialUi(SHARE_BASE, 'Ari')).toEqual(legacy.initialUi(SHARE_BASE, 'Ari'));
    expect(typed.initialUi('', '')).toEqual(legacy.initialUi('', ''));
  });

  test('the catalogue covers every screen and tab', () => {
    const screens = new Set(SCENARIO_NAMES.map((name) => SCENARIOS[name].screen));
    const tabs = new Set(SCENARIO_NAMES.map((name) => SCENARIOS[name].tab));
    expect([...screens].sort()).toEqual(['game', 'lobby', 'menu', 'name', 'spec']);
    expect([...tabs].sort()).toEqual(['ladder', 'play', 'rules']);
    expect(SCENARIO_NAMES.some((name) => SCENARIOS[name].configTarget !== null)).toBe(true);
    expect(SCENARIO_NAMES.some((name) => SCENARIOS[name].handoff !== null)).toBe(true);
    expect(SCENARIO_NAMES.some((name) => SCENARIOS[name].game?.reveal !== null)).toBe(true);
    expect(SCENARIO_NAMES.some((name) => SCENARIOS[name].game?.phase === 'over')).toBe(true);
  });

  describe.each(SCENARIO_NAMES.map((name) => [name] as const))('%s', (name) => {
    test('renders the same tree and its handlers dispatch the same intents', () => {
      const ui = SCENARIOS[name];
      const expected = render(legacy, ui);
      const actual = render(typed, ui);
      expect(actual.tree).toBe(expected.tree);
      expect(actual.tree.length).toBeGreaterThan(200);
      expect(actual.fired).toEqual(expected.fired);
      expect(actual.fired.length).toBeGreaterThan(0);
    });
  });

  test('a re-render into the same root patches to the same tree on both legs', () => {
    const steps: ReadonlyArray<Ui> = [
      SCENARIOS.menu,
      SCENARIOS['name: host'],
      SCENARIOS['lobby: host'],
      SCENARIOS['game: opener, my turn'],
      SCENARIOS['game: facing a bid, not my turn'],
      SCENARIOS['game: revealed, someone else lost'],
      SCENARIOS['ladder: a bid marked, a group opened, its category closed'],
      SCENARIOS['game: over, scored'],
      SCENARIOS.menu,
    ];
    const walk = (leg: Leg): ReadonlyArray<string> => {
      const doc = fakeDocument();
      const root = doc.createElement('div');
      return steps.map((ui) => {
        leg.mount(
          doc,
          root,
          leg.appView(ui, () => undefined),
        );
        return root.childNodes.map(serialize).join('');
      });
    };
    const expected = walk(legacy);
    const actual = walk(typed);
    expect(actual).toEqual(expected);
    // A patched tree equals a fresh render of the same state.
    steps.forEach((ui, i) => {
      expect(actual[i]).toBe(render(typed, ui).tree);
    });
  });
});
