// The render harness for the view tests: mounts `appView(ui)` into a fresh fake document
// (web/shared/edge/dom.fake.ts) and records every intent the handlers dispatch. What a test then
// checks is the same DOM the browser would hold: ids, classes, text and listeners.
import { fakeDocument, recorder, type FakeElement } from '../../../../shared/edge/dom.fake.ts';
import { appView } from './app.ts';
import type { Intent, Ui } from './types.ts';
import { mount } from './vdom.ts';

export type Rendered = Readonly<{
  /** The mount root; the app tree is its one child. */
  root: FakeElement;
  /** What the handlers dispatched so far, in order. */
  intents: () => ReadonlyArray<Intent>;
  /** Render another state into the same root (a re-render, as the controller does). */
  again: (ui: Ui) => void;
}>;

export const renderApp = (ui: Ui): Rendered => {
  const doc = fakeDocument();
  const root = doc.createElement('div');
  const intents = recorder<Intent>();
  const again = (next: Ui): void => {
    mount(doc as unknown as Document, root as unknown as Element, appView(next, intents.record));
  };
  again(ui);
  return { root, intents: intents.recorded, again };
};
