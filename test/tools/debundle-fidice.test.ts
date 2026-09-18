// Pins web/games/fidice/** to the legacy page (docs/MIGRATION.md step 6): re-running
// tools/legacy/debundle-fidice.ts on the HEAD page must reproduce every committed generated file
// byte for byte, MANIFEST.json must pin the bundle range and each file, and the recovered import
// graph must be the one ESM can evaluate in the bundle's order (no cycles, no forward references).
// An edit to the legacy page inside the bundle, or a hand edit of a generated file, fails here; the
// fix is `npm run debundle:fidice` (and, for a page edit, a note on why the oracle moved). A module
// typed in place (docs/MIGRATION.md step 8, `<name>.ts` beside where `<name>.js` was) is
// hand-written: the tool stops emitting it and pins only its provenance (section and lines) in the
// manifest. Since step 9 every section is typed, so the tool generates index.html and theme.css
// alone and the manifest is the map from each .ts back to its bundle lines; the tool stays runnable
// as an audit (`--dry-run` prints the recovered graph) and these tests keep it honest.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  FIDICE_DIR,
  FIDICE_MANIFEST,
  FIDICE_PAGE,
  TOOL,
  debundleFidice,
  portedOnDisk,
  type DebundleManifest,
} from '../../tools/legacy/debundle-fidice.ts';
import { REPO_ROOT, readRepoFile, sha256 } from '../../tools/legacy/extract.ts';

const page = readRepoFile(FIDICE_PAGE);
const debundled = debundleFidice(page, portedOnDisk);
const manifest = JSON.parse(readRepoFile(FIDICE_MANIFEST)) as DebundleManifest;
/** The modules typed so far and the ones the tool still generates (none since step 9). */
const typed = debundled.modules.filter((m) => portedOnDisk(m.section.name));
const generated = debundled.modules.filter((m) => !portedOnDisk(m.section.name));
/** `main.ts` once the entry is typed (docs/MIGRATION.md step 9), `main.js` before. */
const entryFile = portedOnDisk('src/app/main') ? 'main.ts' : 'main.js';

/** Every regular file under web/games/fidice except the manifest, as posix paths relative to it. */
const committedFiles = (): ReadonlyArray<string> =>
  readdirSync(resolve(REPO_ROOT, FIDICE_DIR), { recursive: true, encoding: 'utf8' })
    .map((path) => path.split(sep).join('/'))
    .filter((path) => statSync(resolve(REPO_ROOT, FIDICE_DIR, path)).isFile())
    .filter((path) => path !== 'MANIFEST.json')
    .sort();

describe('the de-bundled fidice modules', () => {
  test('the tool splits the bundle at 39 markers: 38 modules under src/ and the entry', () => {
    const files = [...debundled.files.keys()];
    expect(debundled.modules).toHaveLength(39);
    expect(files.filter((file) => file.startsWith('src/') && file.endsWith('.js'))).toHaveLength(
      38 - typed.filter((m) => m.section.name !== 'src/app/main').length,
    );
    expect(files.includes('main.js')).toBe(entryFile === 'main.js');
    expect(files).toContain('index.html');
    expect(files).toContain('theme.css');
    expect(debundled.modules.map((m) => `${m.section.name}.ts`)).toEqual(
      page
        .split('\n')
        .flatMap((line) => (/^ {2}\/\/ (src\/.+\.ts)$/.exec(line)?.[1] ?? []) as string[]),
    );
  });

  test('every committed file is what the tool cuts from the HEAD page, and nothing else is committed', () => {
    // Typed modules and their companions (types, *.algorithms, tests) are hand-written .ts files.
    expect(committedFiles().filter((file) => !file.endsWith('.ts'))).toEqual(
      [...debundled.files.keys()].sort(),
    );
    debundled.files.forEach((text, file) => {
      expect(readRepoFile(`${FIDICE_DIR}/${file}`), file).toBe(text);
    });
  });

  test('every section is typed (docs/MIGRATION.md step 9): no .js is generated or committed', () => {
    expect(generated).toEqual([]);
    expect(typed).toHaveLength(39);
    expect([...debundled.files.keys()].sort()).toEqual(['index.html', 'theme.css']);
    expect(committedFiles().filter((file) => file.endsWith('.js'))).toEqual([]);
    Object.values(manifest.files)
      .filter((entry) => entry.section !== undefined)
      .forEach((entry) => {
        expect(entry.typed).toBe(true);
      });
  });

  test('a typed module replaces its generated .js, and nothing imports the .js any more', () => {
    typed.forEach(({ section }) => {
      const stem = section.name === 'src/app/main' ? 'main' : section.name;
      expect(section.file, section.name).toBe(`${stem}.ts`);
      expect(existsSync(resolve(REPO_ROOT, FIDICE_DIR, `${stem}.js`)), section.name).toBe(false);
    });
    committedFiles()
      .filter((file) => file.endsWith('.js'))
      .forEach((file) => {
        const text = readRepoFile(`${FIDICE_DIR}/${file}`);
        [...text.matchAll(/(?:from|^import) '(\.[^']+)';$/gm)].forEach((m) => {
          const specifier = m[1] ?? '';
          const target = resolve(REPO_ROOT, FIDICE_DIR, file, '..', specifier);
          expect(existsSync(target), `${file} imports ${specifier}`).toBe(true);
        });
      });
  });

  test('MANIFEST.json pins the bundle range and every file', () => {
    expect(manifest).toEqual(debundled.manifest);
    expect(manifest.page).toBe(FIDICE_PAGE);
    expect(manifest.tool).toBe(TOOL);
    const lines = page.split('\n');
    expect(lines[manifest.startLine - 1]).toBe('"use strict";');
    expect(lines[manifest.endLine - 1]).toBe('})();');
    expect(sha256(lines.slice(manifest.startLine - 1, manifest.endLine).join('\n'))).toBe(
      manifest.sourceSha256,
    );
    Object.entries(manifest.files).forEach(([file, entry]) => {
      if (entry.typed) {
        expect(file).toMatch(/\.ts$/);
        expect(entry.sha256).toBeUndefined();
        expect(existsSync(resolve(REPO_ROOT, FIDICE_DIR, file)), file).toBe(true);
      } else {
        expect(sha256(readRepoFile(`${FIDICE_DIR}/${file}`)), file).toBe(entry.sha256);
      }
    });
  });

  test('each generated module body is the page text at its pinned lines, verbatim', () => {
    const lines = page.split('\n');
    generated.forEach(({ section, text }) => {
      const body = lines.slice(section.startLine - 1, section.endLine).join('\n');
      expect(text, section.file).toContain(`\n${body}\n`);
    });
    debundled.modules.forEach(({ section }) => {
      expect(manifest.files[section.file]).toMatchObject({
        section: `${section.name}.ts`,
        startLine: section.startLine,
        endLine: section.endLine,
      });
    });
  });

  test('the recovered graph has no cycles and no forward references, so ESM evaluates in bundle order', () => {
    expect(debundled.report.cycles).toEqual([]);
    expect(debundled.report.forwardReferences).toEqual([]);
    expect(debundled.report.evaluationOrder).toEqual(debundled.report.bundleOrder);
  });

  test('the entry imports every module in bundle order and exports nothing', () => {
    const main = debundled.modules.at(-1);
    expect(main?.section.file).toBe(entryFile);
    expect(main?.exports).toEqual([]);
    expect(main?.imports.map((imp) => imp.from.name)).toEqual(
      debundled.report.bundleOrder.slice(0, -1),
    );
  });

  test('top-level names stay unique across modules and every export is a declaration of its module', () => {
    const all = debundled.modules.flatMap((m) => m.exports);
    expect(new Set(all).size).toBe(all.length);
    debundled.modules.forEach((m) => {
      m.imports.forEach((imp) => {
        const provider = debundled.modules.find((other) => other.section === imp.from);
        imp.names.forEach((name) => {
          expect(provider?.exports, `${m.section.file} imports ${name}`).toContain(name);
        });
      });
    });
  });

  test('the page keeps its head and boots the entry as a module; the classic scripts go with the typed entry', () => {
    const html = debundled.files.get('index.html') ?? '';
    expect(html).toContain("<title>Fidice — one-cup liar's dice</title>");
    expect(html).toContain('<link rel="preconnect" href="https://fonts.googleapis.com">');
    expect(html).toContain('<link rel="stylesheet" href="./theme.css">');
    expect(html).toContain('<div id="app"></div>');
    expect(html).toContain(`<script type="module" src="./${entryFile}"></script>`);
    expect(html).not.toContain('<style>');
    expect(html).not.toContain('"use strict"');
    // Step 9: PeerJS and the ICE loader are bundled through web/shared/edge (main.ts), so the
    // page defines neither `window.Peer` nor `window.HyperIce`; before that it loaded both.
    const peerCdn = '<script src="https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js"></script>';
    const iceScript = '<script vite-ignore src="../../shared/ice.js"></script>';
    expect(html.includes(peerCdn)).toBe(entryFile === 'main.js');
    expect(html.includes(iceScript)).toBe(entryFile === 'main.js');
    expect(/shared\/ice\.js|peerjs\.min\.js/.test(html)).toBe(entryFile === 'main.js');
  });

  test('theme.css is the two <style> blocks of the page in order', () => {
    const css = debundled.files.get('theme.css') ?? '';
    const styles = [...page.matchAll(/<style>\n([\s\S]*?)<\/style>/g)].map((m) => m[1] ?? '');
    expect(styles).toHaveLength(2);
    styles.forEach((block) => {
      expect(css).toContain(block);
    });
    expect(css.indexOf(styles[0] ?? '')).toBeLessThan(css.indexOf(styles[1] ?? ''));
  });

  test('the generated files exist on disk and carry no trailing whitespace', () => {
    committedFiles().forEach((file) => {
      const path = resolve(REPO_ROOT, FIDICE_DIR, file);
      expect(existsSync(path), file).toBe(true);
    });
    debundled.modules.forEach(({ section, text }) => {
      expect(
        text.split('\n').filter((line) => /\s$/.test(line)),
        `${section.file} trailing whitespace`,
      ).toEqual([]);
    });
  });
});
