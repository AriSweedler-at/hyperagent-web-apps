// The glob dialect tools/ci/suites.ts spells its paths in, matched without a dependency: vitest's
// picomatch is a transitive package this repo does not list, and node:path's matchesGlob prints an
// ExperimentalWarning per process on Node 22, which would head every vitest run and every pre-push.
// The dialect is the one the include globs already use: `**` for any run of directories, `*` and
// `?` inside one segment, `{a,b}` for alternatives, everything else literal. Paths are matched
// whole and repo-relative with forward slashes (what `git diff --name-only` and the walker print).

const escape = (literal: string): string => literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A segment's `*`, `?` and `{a,b}`; every other character literal. */
const segmentToSource = (segment: string): string =>
  segment
    .split(/(\{[^}]*\}|\*|\?)/)
    .filter((part) => part !== '')
    .map((part) => {
      if (part === '*') return '[^/]*';
      if (part === '?') return '[^/]';
      if (part.startsWith('{') && part.endsWith('}')) {
        return `(?:${part.slice(1, -1).split(',').map(escape).join('|')})`;
      }
      return escape(part);
    })
    .join('');

/**
 * The RegExp of one glob. A `**` segment is any number of directories, none included, so
 * `web/**\/x.ts` matches `web/x.ts` and a trailing `dir/**` matches everything below `dir/`.
 */
export const globToRegExp = (glob: string): RegExp => {
  const segments = glob.split('/');
  const source = segments
    .map((segment, i) => {
      const last = i === segments.length - 1;
      if (segment === '**') return last ? '.*' : '(?:[^/]+/)*';
      return last ? segmentToSource(segment) : `${segmentToSource(segment)}/`;
    })
    .join('');
  return new RegExp(`^${source}$`);
};

/** True when `path` matches any of `globs`. */
export const matchesAny = (path: string, globs: ReadonlyArray<string>): boolean =>
  globs.some((glob) => globToRegExp(glob).test(path));
