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
// evaluation order is the bundle order whenever the recovered graph points backwards. Until
// docs/MIGRATION.md step 14 the page's markup and its two `<style>` blocks were cut into index.html
// and theme.css beside the modules and pinned byte for byte; step 14 hoisted the shared primitives
// out of theme.css and linked web/shared/styles from index.html, so both are hand-owned now (the
// computed-style goldens, the class contract and the e2e specs are their oracles) and the tool no
// longer cuts them. With every section typed (the end of step 9) it writes the manifest only; it
// remains the audit that maps each typed module to its bundle lines and recovers the legacy import
// graph. Run:
//   node --experimental-strip-types tools/legacy/debundle-fidice.ts     (npm run debundle:fidice)
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
const ENTRY_STEM = 'main';
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
  /** Absent for a typed module: its .ts is hand-written, so only its provenance is pinned. */
  sha256?: string;
  /** The module has been typed (docs/MIGRATION.md step 8): the key is its .ts path. */
  typed?: true;
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

/** Whether a section is already typed: is a `<name>.ts` sitting where the tool would write `<name>.js`? */
export type IsPorted = (name: string) => boolean;

const NONE_PORTED: IsPorted = () => false;

/** Where a section lives under web/games/fidice, extension aside: the entry sits beside index.html. */
const stemFor = (name: string): string => (name === ENTRY_SECTION ? ENTRY_STEM : name);

/** The checked-in answer: docs/MIGRATION.md step 8 types the modules in place, `.js` -> `.ts`. */
export const portedOnDisk: IsPorted = (name) =>
  existsSync(resolve(REPO_ROOT, FIDICE_DIR, `${stemFor(name)}.ts`));

/**
 * Output path of a section. A typed module is `<name>.ts`: the tool no longer writes it, but the
 * modules still importing it need the `.ts` specifier and the manifest still pins its provenance.
 */
const fileFor = (name: string, isPorted: IsPorted): string =>
  `${stemFor(name)}.${isPorted(name) ? 'ts' : 'js'}`;

export const splitSections = (
  lines: ReadonlyArray<string>,
  isPorted: IsPorted = NONE_PORTED,
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
      file: fileFor(name, isPorted),
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
// Whole thing
// ---------------------------------------------------------------------------------------------

export const debundleFidice = (page: string, isPorted: IsPorted = NONE_PORTED): Debundled => {
  const lines = page.split('\n');
  const { start, close, sections } = splitSections(lines, isPorted);
  // The body is analysed as JavaScript whatever the output extension: ESLint's default file
  // patterns select the parser by the name it is given, and a `.ts` name would select none.
  const analyses = sections.map((section) =>
    analyze(section.body.join('\n'), `${section.name}.js`),
  );

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

  // A typed module is not written: its .ts is hand-typed from the same body (step 8).
  const generated = modules.filter((m) => !isPorted(m.section.name));
  const files = new Map<string, string>(
    generated.map((m): [string, string] => [m.section.file, m.text]),
  );

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
    // Bundle order, typed modules included at their place: test/parity/fidice.api.ts reads the
    // module list from here. index.html and theme.css are hand-owned since step 14 (see the header).
    files: Object.fromEntries(
      modules.map(({ section, text }): [string, FileEntry] => [
        section.file,
        {
          section: `${section.name}.ts`,
          startLine: section.startLine,
          endLine: section.endLine,
          ...(isPorted(section.name) ? { typed: true } : { sha256: sha256(text) }),
        },
      ]),
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
  const debundled = debundleFidice(readRepoFile(FIDICE_PAGE), portedOnDisk);
  if (!process.argv.includes('--dry-run')) writeDebundle(debundled);
  printReport(debundled);
}
