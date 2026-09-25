// The drawn pack's files are committed (docs/design/card-packs.md §5): this regenerates the forty
// faces, the back and the manifest in memory and compares them to the tree, so a changed symbol,
// layout or path is caught until `node --experimental-strip-types tools/linea.ts` is re-run. The
// faces themselves are checked for what a picture of a card must have: one root, the card's box,
// its own suit symbol defined once, the index twice, and a size a phone loads without noticing.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

import { cardIds } from '../web/shared/lib/cards/decks.ts';
import { FACE_IDS, MANIFEST_PATH, PUBLIC_DIR, backSvg, faceSvg, outputs } from './linea.ts';

const ROOT = resolve(import.meta.dirname, '..');
const committed = (path: string): string => readFileSync(resolve(ROOT, path), 'utf8');

describe('the linea pack is what the tool writes', () => {
  test('forty faces, the back and the manifest, at their paths', () => {
    const files = outputs();
    expect(files).toHaveLength(42);
    expect(FACE_IDS).toEqual(cardIds('italian40'));
    expect(files.map((f) => f.path)).toEqual([
      ...FACE_IDS.map((id) => `${PUBLIC_DIR}/italian40/${id}.svg`),
      `${PUBLIC_DIR}/back.svg`,
      MANIFEST_PATH,
    ]);
  });

  test.each(outputs().map((f) => [f.path, f.text] as const))(
    '%s is committed as generated',
    (path, text) => {
      expect(committed(path)).toBe(text);
    },
  );

  test.each(FACE_IDS)(
    '%s: one svg in the 100 × 193 box, the suit defined once and used, the index twice, under 4 KB',
    (id) => {
      const svg = faceSvg(id);
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 193">')).toBe(
        true,
      );
      expect(svg.endsWith('</svg>\n')).toBe(true);
      expect(svg.match(/<svg /g)).toHaveLength(1);
      expect(svg.match(/<defs>/g)).toHaveLength(1);
      // The corner index, upright and turned: the rank's letter, twice.
      expect(svg.match(/font-size="14"[^>]*>[A-Z0-9]+<\/text>/g)).toHaveLength(2);
      expect(svg.match(/<use href="#s"/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
      expect(Buffer.byteLength(svg)).toBeLessThan(4096);
    },
  );

  test('a stranger draws nothing; the back is one svg with the four suits in its medallion, under 4 KB', () => {
    expect(faceSvg('KC')).toBe('');
    expect(faceSvg('7H')).toBe('');
    const back = backSvg();
    expect(back.match(/<svg /g)).toHaveLength(1);
    expect(back.match(/<g transform=/g)).toHaveLength(4);
    expect(back).toContain('<pattern id="l"');
    expect(Buffer.byteLength(back)).toBeLessThan(4096);
  });
});
