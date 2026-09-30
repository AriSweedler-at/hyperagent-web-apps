import { describe, expect, it } from 'vitest';

import { HELP_CLASS, STEP_TITLE, bindHelpFold, type ClickEvent, type HelpDoc } from './helpFold.ts';

/** A page with the mount: the handler it was given and the body's classes. */
const fakeDoc = (withMount: boolean) => {
  const classes = new Set<string>();
  const handlers: ((e: ClickEvent) => void)[] = [];
  const doc: HelpDoc = {
    getElementById: (id) =>
      withMount && id === 'fidiceTable'
        ? {
            addEventListener: (_type, handler) => {
              handlers.push(handler);
            },
          }
        : null,
    body: {
      classList: {
        toggle: (name) => {
          if (classes.has(name)) classes.delete(name);
          else classes.add(name);
          return classes.has(name);
        },
      },
    },
  };
  const click = (target: unknown) => {
    handlers.forEach((h) => {
      h({ target });
    });
  };
  return { doc, classes, handlers, click };
};

/** A target inside a step's title, or outside every one. */
const inTitle = (yes: boolean) => ({
  closest: (selector: string) => (yes && selector === STEP_TITLE ? {} : null),
});

describe('bindHelpFold', () => {
  it('binds one listener on the mount and says so; without the mount it binds nothing', () => {
    const page = fakeDoc(true);
    expect(bindHelpFold(page.doc)).toBe(true);
    expect(page.handlers).toHaveLength(1);
    const dark = fakeDoc(false);
    expect(bindHelpFold(dark.doc)).toBe(false);
    expect(dark.handlers).toHaveLength(0);
  });

  it('a tap in a step title toggles the body class, a second tap clears it; taps elsewhere and non-element targets do nothing', () => {
    const page = fakeDoc(true);
    bindHelpFold(page.doc);
    page.click(inTitle(true));
    expect([...page.classes]).toEqual([HELP_CLASS]);
    page.click(inTitle(false));
    page.click(null);
    page.click('text');
    expect([...page.classes]).toEqual([HELP_CLASS]);
    page.click(inTitle(true));
    expect([...page.classes]).toEqual([]);
  });
});
