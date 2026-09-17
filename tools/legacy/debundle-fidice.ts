// Splits the fidice esbuild bundle in legacy/fidice/index.html into ES modules under
// web/games/fidice/ (docs/MIGRATION.md step 6). The bundle is one IIFE whose sections start with a
// `// src/<path>.ts` marker; every top-level statement is a `var` declaration except the final
// `boot();`, and esbuild already made every top-level name unique across the bundle (its `h2`,
// `turnKey2`, `clamp3` renames), so each section becomes the module at its marker path with its
// body verbatim, a trailing `export { ... }` of its top-level bindings, and an `import` for every
// free identifier another section declares. Names are kept exactly as esbuild left them: a
// module's body is the same text at the same scope depth as in the bundle, so shadowing and
// behaviour are unchanged, and step 8 tidies the names when it types the modules.
//
// Free identifiers and declarations come from ESLint's scope manager (eslint is a devDependency;
// `Linter.verify` with a one-off rule is the supported way to reach it), not from regular
// expressions. The tool also refuses what ESM cannot reproduce: a cross-module write, a duplicate
// top-level name, or an eager (module-evaluation-time) reference to a module that evaluates later.
// `report` records the import cycles, the forward (lazy) references and the ESM evaluation order
// so test/tools/debundle-fidice.test.ts can pin them.
//
// The last section (`src/app/main.ts`) becomes web/games/fidice/main.js and imports every other
// module in bundle order (named where it uses one, side-effect only otherwise), so the ESM
// evaluation order is the bundle order whenever the recovered graph points backwards. The page's
// markup and its two `<style>` blocks are cut into index.html and theme.css beside it. Run:
//   node --experimental-strip-types tools/legacy/debundle-fidice.ts     (npm run debundle:fidice)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';

import { Linter, type Rule, type Scope } from 'eslint';

import { REPO_ROOT, findLine, isMain, readRepoFile, sha256, trimBlankBefore } from './extract.ts';

export const FIDICE_PAGE = 'legacy/fidice/index.html';
export const FIDICE_DIR = 'web/games/fidice';
export const FIDICE_MANIFEST = `${FIDICE_DIR}/MANIFEST.json`;
export const TOOL = 'tools/legacy/debundle-fidice.ts';

const USE_STRICT = '"use strict";';
const IIFE_OPEN = '(() => {';
const IIFE_CLOSE = '})();';
const MARKER = /^ {2}\/\/ (src\/[\w./-]+)\.ts$/;
const ENTRY_SECTION = 'src/app/main';
const ENTRY_FILE = 'main.js';
const ICE_SCRIPT = '<script src="../../shared/ice.js"></script>';
const STYLESHEET_LINK = '<link rel="stylesheet" href="./theme.css">';
const MODULE_SCRIPT = '<script type="module" src="./main.js"></script>';
const NAMES_PER_LINE = 8;
const LINE_WIDTH = 100;

export type Section = Readonly<{
  /** Marker path without extension: `src/domain/hands`. */
  name: string;
  /** Output path under web/games/fidice: `src/domain/hands.js`, or `main.js` for the entry. */
  file: string;
  /** 1-based inclusive page lines of the body (the marker line excluded). */
  startLine: number;
  endLine: number;
  body: ReadonlyArray<string>;
}>;

type FreeRef = Readonly<{ name: string; eager: boolean; write: boolean }>;
type Analysis = Readonly<{ declared: ReadonlyArray<string>; refs: ReadonlyArray<FreeRef> }>;

export type Import = Readonly<{ from: Section; names: ReadonlyArray<string> }>;
export type Module = Readonly<{
  section: Section;
  imports: ReadonlyArray<Import>;
  exports: ReadonlyArray<string>;
  text: string;
}>;

export type Report = Readonly<{
  /** Every import cycle in the recovered graph, as section names. */
  cycles: ReadonlyArray<ReadonlyArray<string>>;
  /** Imports of a module that comes later in the bundle (lazy, or ESM would refuse them). */
  forwardReferences: ReadonlyArray<
    Readonly<{ from: string; to: string; names: ReadonlyArray<string> }>
  >;
  /** The order ESM evaluates the modules from main.js; equals the bundle order when no cycle intrudes. */
  evaluationOrder: ReadonlyArray<string>;
  bundleOrder: ReadonlyArray<string>;
}>;

export type FileEntry = Readonly<{
  sha256: string;
  section?: string;
  startLine?: number;
  endLine?: number;
}>;

export type DebundleManifest = Readonly<{
  page: string;
  tool: string;
  /** 1-based inclusive page lines of the bundle, `"use strict";` through `})();`. */
  startLine: number;
  endLine: number;
  sourceSha256: string;
  files: Readonly<Record<string, FileEntry>>;
}>;

export type Debundled = Readonly<{
  /** Output path under web/games/fidice -> file text. */
  files: ReadonlyMap<string, string>;
  modules: ReadonlyArray<Module>;
  manifest: DebundleManifest;
  report: Report;
}>;

// ---------------------------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------------------------

const fileFor = (name: string): string => (name === ENTRY_SECTION ? ENTRY_FILE : `${name}.js`);

export const splitSections = (
  lines: ReadonlyArray<string>,
): Readonly<{ start: number; close: number; sections: ReadonlyArray<Section> }> => {
  const start = findLine(lines, (line) => line === USE_STRICT, USE_STRICT);
  if (lines[start + 1] !== IIFE_OPEN) throw new Error(`expected ${IIFE_OPEN} after ${USE_STRICT}`);
  const close = findLine(lines, (line) => line === IIFE_CLOSE, IIFE_CLOSE, start);
  const markers = lines.flatMap((line, i) =>
    i > start && i < close && MARKER.test(line) ? [i] : [],
  );
  const sections = markers.map((marker, k): Section => {
    const name = MARKER.exec(lines[marker] ?? '')?.[1];
    if (name === undefined) throw new Error(`bad marker at line ${String(marker + 1)}`);
    const end = trimBlankBefore(lines, markers[k + 1] ?? close);
    return {
      name,
      file: fileFor(name),
      startLine: marker + 2,
      endLine: end,
      body: lines.slice(marker + 1, end),
    };
  });
  if (sections.at(-1)?.name !== ENTRY_SECTION)
    throw new Error(`the last section must be ${ENTRY_SECTION}`);
  const names = sections.map((s) => s.name);
  if (new Set(names).size !== names.length) throw new Error('duplicate section marker');
  return { start, close, sections };
};

// ---------------------------------------------------------------------------------------------
// Scope analysis
// ---------------------------------------------------------------------------------------------

/** Lazy when the reference sits inside a function body (or a class field), which runs after evaluation. */
const isEager = (from: Scope.Scope): boolean => {
  const lazyKinds: ReadonlyArray<Scope.Scope['type']> = [
    'function',
    'function-expression-name',
    'class-field-initializer',
  ];
  const chain = (scope: Scope.Scope | null): boolean =>
    scope === null || scope.type === 'module'
      ? true
      : lazyKinds.includes(scope.type)
        ? false
        : chain(scope.upper);
  return chain(from);
};

/** Top-level declarations and free identifiers of one section parsed as an ES module. */
export const analyze = (code: string, file: string): Analysis => {
  const found: Analysis[] = [];
  const collect: Rule.RuleModule = {
    create: (context) => ({
      'Program:exit': () => {
        const moduleScope = context.sourceCode.scopeManager.globalScope?.childScopes.find(
          (scope) => scope.type === 'module',
        );
        if (moduleScope === undefined) throw new Error(`${file}: no module scope`);
        found.push({
          declared: moduleScope.variables.map((variable) => variable.name),
          refs: moduleScope.through.map((ref) => ({
            name: ref.identifier.name,
            eager: isEager(ref.from),
            write: ref.isWrite(),
          })),
        });
      },
    }),
  };
  const messages = new Linter().verify(
    code,
    [
      {
        plugins: { debundle: { rules: { collect } } },
        rules: { 'debundle/collect': 'error' },
        languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
      },
    ],
    file,
  );
  const fatal = messages.filter((message) => message.fatal);
  if (fatal.length > 0)
    throw new Error(`${file}: ${fatal.map((message) => message.message).join('; ')}`);
  const analysis = found[0];
  if (analysis === undefined) throw new Error(`${file}: analysis did not run`);
  return analysis;
};

// ---------------------------------------------------------------------------------------------
// Module text
// ---------------------------------------------------------------------------------------------

const specifierFor = (fromFile: string, toFile: string): string => {
  const rel = posix.relative(posix.dirname(fromFile), toFile);
  return rel.startsWith('.') ? rel : `./${rel}`;
};

/** `export { a, b };` on one line, or one name per line when it would pass the width. */
const bindingList = (keyword: string, names: ReadonlyArray<string>, tail: string): string => {
  const oneLine = `${keyword} { ${names.join(', ')} }${tail}`;
  if (oneLine.length <= LINE_WIDTH) return oneLine;
  const rows = Array.from(
    { length: Math.ceil(names.length / NAMES_PER_LINE) },
    (_, i) => `  ${names.slice(i * NAMES_PER_LINE, (i + 1) * NAMES_PER_LINE).join(', ')},`,
  );
  return [`${keyword} {`, ...rows, `}${tail}`].join('\n');
};

const importLine = (own: Section, imp: Import): string => {
  const specifier = specifierFor(own.file, imp.from.file);
  return imp.names.length === 0
    ? `import '${specifier}';`
    : bindingList('import', imp.names, ` from '${specifier}';`);
};

const header = (section: Section): ReadonlyArray<string> => [
  `// GENERATED by ${TOOL} from ${FIDICE_PAGE} lines ${String(section.startLine)}-${String(section.endLine)}`,
  `// (bundle section "// ${section.name}.ts"): the body is verbatim, indentation included; the imports`,
  `// and exports were recovered by scope analysis. Do not edit: \`npm run debundle:fidice\` regenerates`,
  `// it and test/tools/debundle-fidice.test.ts checks it (docs/MIGRATION.md step 6; step 8 types it).`,
];

const moduleText = (
  section: Section,
  imports: ReadonlyArray<Import>,
  exports: ReadonlyArray<string>,
): string => {
  const importBlock = imports.map((imp) => importLine(section, imp));
  const exportBlock = exports.length > 0 ? ['', bindingList('export', exports, ';')] : [];
  return [
    ...header(section),
    ...(importBlock.length > 0 ? ['', ...importBlock] : []),
    '',
    ...section.body,
    ...exportBlock,
    '',
  ].join('\n');
};

// ---------------------------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------------------------

const findCycles = (
  deps: ReadonlyArray<ReadonlyArray<number>>,
): ReadonlyArray<ReadonlyArray<number>> => {
  const cycles: number[][] = [];
  const state: ('new' | 'active' | 'done')[] = deps.map(() => 'new');
  const walk = (node: number, path: ReadonlyArray<number>): void => {
    if (state[node] === 'done') return;
    if (state[node] === 'active') {
      cycles.push([...path.slice(path.indexOf(node)), node]);
      return;
    }
    state[node] = 'active';
    (deps[node] ?? []).forEach((next) => {
      walk(next, [...path, node]);
    });
    state[node] = 'done';
  };
  deps.forEach((_, i) => {
    walk(i, []);
  });
  return cycles;
};

/** The order ESM evaluates modules from the entry: each module's imports first, in import order. */
const evaluationOrder = (
  deps: ReadonlyArray<ReadonlyArray<number>>,
  entry: number,
): ReadonlyArray<number> => {
  const order: number[] = [];
  const seen = new Set<number>();
  const visit = (node: number): void => {
    if (seen.has(node)) return;
    seen.add(node);
    (deps[node] ?? []).forEach(visit);
    order.push(node);
  };
  visit(entry);
  return order;
};

// ---------------------------------------------------------------------------------------------
// Page markup
// ---------------------------------------------------------------------------------------------

const cutMarkup = (
  lines: ReadonlyArray<string>,
  start: number,
  close: number,
): Readonly<{ html: string; css: string }> => {
  const headEnd = findLine(lines, (line) => line === '</head>', '</head>');
  const styleOpens = lines.flatMap((line, i) => (i < headEnd && line === '<style>' ? [i] : []));
  const styleCloses = lines.flatMap((line, i) => (i < headEnd && line === '</style>' ? [i] : []));
  if (styleOpens.length === 0 || styleOpens.length !== styleCloses.length)
    throw new Error('unbalanced <style> blocks in <head>');
  const firstStyle = styleOpens[0] ?? 0;
  const lastStyle = styleCloses.at(-1) ?? 0;
  const scriptOpen = start - 1;
  if (lines[scriptOpen] !== '<script>') throw new Error(`expected <script> before ${USE_STRICT}`);
  // A blank line separates `})();` from its `</script>`.
  const scriptClose = findLine(lines, (line) => line === '</script>', '</script>', close);
  if (lines.slice(close + 1, scriptClose).some((line) => line.trim() !== ''))
    throw new Error(`unexpected text between ${IIFE_CLOSE} and </script>`);
  const iceLine = findLine(lines, (line) => line === ICE_SCRIPT, ICE_SCRIPT);
  const html = [
    ...lines
      .slice(0, firstStyle)
      .map((line, i) =>
        i === iceLine ? ICE_SCRIPT.replace('<script ', '<script vite-ignore ') : line,
      ),
    STYLESHEET_LINK,
    ...lines.slice(lastStyle + 1, scriptOpen),
    MODULE_SCRIPT,
    ...lines.slice(scriptClose + 1),
  ].join('\n');
  const cssHeader = [
    `/* GENERATED by ${TOOL} from ${FIDICE_PAGE}: the page's two style blocks, verbatim and in`,
    `   order (the second is the stray .ha-img-placeholder block, kept until docs/MIGRATION.md step 15). */`,
  ];
  const css = [
    ...cssHeader,
    ...styleOpens.flatMap((open, k) => lines.slice(open + 1, styleCloses[k] ?? open + 1)),
  ].join('\n');
  return { html, css };
};

// ---------------------------------------------------------------------------------------------
// Whole thing
// ---------------------------------------------------------------------------------------------

export const debundleFidice = (page: string): Debundled => {
  const lines = page.split('\n');
  const { start, close, sections } = splitSections(lines);
  const analyses = sections.map((section) => analyze(section.body.join('\n'), section.file));

  const declaredIn = new Map<string, number>();
  analyses.forEach((analysis, i) => {
    analysis.declared.forEach((name) => {
      const other = declaredIn.get(name);
      if (other !== undefined)
        throw new Error(
          `${name} is declared in both ${sections[other]?.name ?? '?'} and ${sections[i]?.name ?? '?'}`,
        );
      declaredIn.set(name, i);
    });
  });

  /** Per section: target section index -> the names it takes from there. */
  const wanted = analyses.map((analysis, i) => {
    const byTarget = new Map<number, Set<string>>();
    analysis.refs.forEach((ref) => {
      const target = declaredIn.get(ref.name);
      if (target === undefined || target === i) return;
      if (ref.write)
        throw new Error(
          `${sections[i]?.name ?? '?'} writes ${ref.name} of ${sections[target]?.name ?? '?'}`,
        );
      (byTarget.get(target) ?? byTarget.set(target, new Set()).get(target))?.add(ref.name);
    });
    return byTarget;
  });

  const entry = sections.length - 1;
  const deps = wanted.map((byTarget, i) =>
    i === entry
      ? sections.slice(0, entry).map((_, k) => k)
      : [...byTarget.keys()].sort((a, b) => a - b),
  );
  const cycles = findCycles(deps);
  const order = evaluationOrder(deps, entry);
  const position = new Map(order.map((node, k) => [node, k]));

  analyses.forEach((analysis, i) => {
    analysis.refs
      .filter((ref) => ref.eager)
      .forEach((ref) => {
        const target = declaredIn.get(ref.name);
        if (target === undefined || target === i) return;
        if ((position.get(target) ?? -1) > (position.get(i) ?? -1))
          throw new Error(
            `${sections[i]?.name ?? '?'} reads ${ref.name} at evaluation time but ${sections[target]?.name ?? '?'} evaluates later`,
          );
      });
  });

  const modules = sections.map((section, i): Module => {
    const byTarget = wanted[i] ?? new Map<number, Set<string>>();
    const imports = (deps[i] ?? []).map((target): Import => ({
      from: sections[target] ?? section,
      names: [...(byTarget.get(target) ?? [])].sort(),
    }));
    const exports = i === entry ? [] : (analyses[i]?.declared ?? []);
    return { section, imports, exports, text: moduleText(section, imports, exports) };
  });

  const { html, css } = cutMarkup(lines, start, close);
  const files = new Map<string, string>([
    ['index.html', `${html}${page.endsWith('\n') ? '' : '\n'}`],
    ['theme.css', `${css}\n`],
    ...modules.map((m): [string, string] => [m.section.file, m.text]),
  ]);

  const nameOf = (i: number): string => sections[i]?.name ?? '?';
  const report: Report = {
    cycles: cycles.map((cycle) => cycle.map(nameOf)),
    forwardReferences: wanted.flatMap((byTarget, i) =>
      [...byTarget.entries()]
        .filter(([target]) => target > i)
        .map(([target, names]) => ({
          from: nameOf(i),
          to: nameOf(target),
          names: [...names].sort(),
        })),
    ),
    evaluationOrder: order.map(nameOf),
    bundleOrder: sections.map((s) => s.name),
  };

  const manifest: DebundleManifest = {
    page: FIDICE_PAGE,
    tool: TOOL,
    startLine: start + 1,
    endLine: close + 1,
    sourceSha256: sha256(lines.slice(start, close + 1).join('\n')),
    files: Object.fromEntries(
      [...files.entries()].map(([file, text]): [string, FileEntry] => {
        const module = modules.find((m) => m.section.file === file);
        return [
          file,
          module === undefined
            ? { sha256: sha256(text) }
            : {
                section: `${module.section.name}.ts`,
                startLine: module.section.startLine,
                endLine: module.section.endLine,
                sha256: sha256(text),
              },
        ];
      }),
    ),
  };

  return { files, modules, manifest, report };
};

export const writeDebundle = (debundled: Debundled): void => {
  debundled.files.forEach((text, file) => {
    const target = resolve(REPO_ROOT, FIDICE_DIR, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  });
  writeFileSync(
    resolve(REPO_ROOT, FIDICE_MANIFEST),
    `${JSON.stringify(debundled.manifest, null, 2)}\n`,
  );
};

const printReport = (debundled: Debundled): void => {
  const { report, manifest, modules } = debundled;
  console.log(
    `${FIDICE_DIR}: ${String(modules.length)} modules from ${FIDICE_PAGE} lines ${String(manifest.startLine)}-${String(manifest.endLine)}`,
  );
  modules.forEach((m) => {
    const from = m.imports.filter((imp) => imp.names.length > 0).map((imp) => imp.from.name);
    console.log(
      `  ${m.section.file}: ${String(m.exports.length)} exports, imports ${String(from.length)} modules`,
    );
  });
  report.forwardReferences.forEach(({ from, to, names }) => {
    console.log(`  forward (lazy): ${from} -> ${to}: ${names.join(', ')}`);
  });
  report.cycles.forEach((cycle) => {
    console.log(`  cycle: ${cycle.join(' -> ')}`);
  });
  const same = report.evaluationOrder.join() === report.bundleOrder.join();
  console.log(`  ESM evaluation order ${same ? 'equals' : 'DIFFERS FROM'} the bundle order`);
};

if (isMain(import.meta.url)) {
  const debundled = debundleFidice(readRepoFile(FIDICE_PAGE));
  if (!process.argv.includes('--dry-run')) writeDebundle(debundled);
  printReport(debundled);
}
