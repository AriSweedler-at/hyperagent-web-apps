// The cross-platform normalisation of the computed-style goldens (docs/MIGRATION.md step 14):
// what tools/parity/computed-styles.ts records for `font-family` must not depend on whether the
// golden was recorded on macOS or replayed on the Linux runner.
import { describe, expect, test } from 'vitest';

import { normaliseFont } from '../../tools/parity/computed-styles.ts';

describe('normaliseFont', () => {
  test('the macOS system-font alias reads as system-ui, as Chromium on macOS already serialises it', () => {
    expect(
      normaliseFont(
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      ),
    ).toBe('-apple-system, "system-ui", "Segoe UI", Roboto, Helvetica, Arial, sans-serif');
  });

  test('the UA default serif reads as Times, the macOS spelling, on Linux too', () => {
    expect(normaliseFont('"Times New Roman"')).toBe('Times');
    expect(normaliseFont('Times')).toBe('Times');
  });

  test('a stack without a platform spelling is unchanged', () => {
    expect(normaliseFont("'Nunito', system-ui, sans-serif")).toBe(
      "'Nunito', system-ui, sans-serif",
    );
    expect(normaliseFont('Fredoka')).toBe('Fredoka');
  });
});
