// Glossary links (docs/design/glossary-links.md): jargon in a game's About copy, and in a rule that
// names another rule, is a link to that rule. The owner: "Clicking jargon in the 'about' section
// will take you to the 'rules' section. This should be true for ALL of the games." Pure and
// shared: a game supplies its rules as `RuleItem`s with ids and its `Glossary` (the words that mean
// each rule); these helpers build the rules list with the anchors, wrap the terms in links and read
// a `#rule-<id>` deep link. The edge that scrolls and flashes the rule is web/shared/edge/glossary.ts.

/** A rule item: an id (the anchor), its heading and body as safe HTML (the body may contain jargon). */
export type RuleItem = Readonly<{ id: string; heading: string; body: string }>;

/** A glossary entry: the words that mean this rule (whole words, any case; phrases allowed). */
export type GlossaryEntry = Readonly<{ rule: string; terms: ReadonlyArray<string> }>;
export type Glossary = ReadonlyArray<GlossaryEntry>;

const ANCHOR_PREFIX = 'rule-';

/** The element id of a rule: `rule-<id>`, the `<li>`'s id and the hash a deep link carries. */
export const ruleAnchor = (id: string): string => `${ANCHOR_PREFIX}${id}`;

/** The class every jargon link carries (styled by each theme; the edge delegates clicks on it). */
export const JARGON_CLASS = 'jargon';

/** A term and the rule it means, one row per term. */
type Term = Readonly<{ term: string; rule: string }>;
/** A term with its place in the glossary, for a stable sort. */
type Ranked = Readonly<{ row: Term; index: number }>;

/** A regexp that matches `text` literally. */
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The first whole-word occurrence of `term`, any case. */
const wordPattern = (term: string): RegExp => new RegExp(`\\b(${escapeRegExp(term)})\\b`, 'i');

/**
 * `html` cut at every tag: even indices are text, odd indices are tags (`<…>`), so a term can never
 * be matched inside a tag's name or attributes.
 */
const segments = (html: string): ReadonlyArray<string> => html.split(/(<[^>]*>)/);

/** For each segment, whether it sits inside an `<a>` already open (its own text is never re-linked). */
const insideAnchor = (parts: ReadonlyArray<string>): ReadonlyArray<boolean> =>
  parts
    .reduce<ReadonlyArray<Readonly<{ depth: number; inside: boolean }>>>((acc, part) => {
      const depth = acc.at(-1)?.depth ?? 0;
      const opens = /^<a[\s>]/i.test(part);
      const closes = /^<\/a\s*>/i.test(part);
      return [...acc, { depth: depth + (opens ? 1 : 0) - (closes ? 1 : 0), inside: depth > 0 }];
    }, [])
    .map((s) => s.inside);

const linkTag = (rule: string, word: string): string =>
  `<a class="${JARGON_CLASS}" href="#${ruleAnchor(rule)}" data-rule="${rule}">${word}</a>`;

/**
 * `html` with the first occurrence of `term` (outside tags and existing links) wrapped as a link to
 * `rule`; `html` unchanged when the term is absent.
 */
const linkOne = (html: string, { term, rule }: Term): string => {
  const parts = segments(html);
  const inside = insideAnchor(parts);
  const pattern = wordPattern(term);
  const at = parts.findIndex(
    (part, i) => i % 2 === 0 && !(inside[i] ?? false) && pattern.test(part),
  );
  if (at === -1) return html;
  return parts
    .map((part, i) =>
      i === at ? part.replace(pattern, (_m, word: string) => linkTag(rule, word)) : part,
    )
    .join('');
};

/**
 * Every term of `glossary` (minus the rule `except`), longest first so "doubling cube" wins over
 * "cube" and "bear them off" over "bear off"; ties keep the glossary's order.
 */
const termsOf = (glossary: Glossary, except: string | undefined): ReadonlyArray<Term> =>
  glossary
    .filter((entry) => entry.rule !== except)
    .flatMap((entry) => entry.terms.map((term): Term => ({ term, rule: entry.rule })))
    .map((row, index): Ranked => ({ row, index }))
    .sort((a: Ranked, b: Ranked) => b.row.term.length - a.row.term.length || a.index - b.index)
    .map((ranked: Ranked) => ranked.row);

/** `short` is a word inside a longer term already linked for the same rule ("cube" in "doubling cube"). */
const insideLinkedTerm = (linked: ReadonlyArray<Term>, short: Term): boolean =>
  linked.some(
    (long) =>
      long.rule === short.rule &&
      long.term !== short.term &&
      wordPattern(short.term).test(long.term),
  );

/**
 * `html` with its jargon linked: every term on its first occurrence (longest terms first), whole
 * words, any case, never inside a tag or an existing `<a>`. A word that is part of a longer term
 * already linked for the same rule is left alone, so "adds the doubling cube" after a linked
 * "doubling cube" does not grow a link on "cube" alone. `except` is the rule this text sits in, so
 * a rule never links to itself.
 */
export const linkJargon = (
  html: string,
  glossary: Glossary,
  options: Readonly<{ except?: string }> = {},
): string =>
  termsOf(glossary, options.except).reduce<Readonly<{ html: string; linked: ReadonlyArray<Term> }>>(
    (acc, term) => {
      if (insideLinkedTerm(acc.linked, term)) return acc;
      const next = linkOne(acc.html, term);
      return next === acc.html ? acc : { html: next, linked: [...acc.linked, term] };
    },
    { html, linked: [] },
  ).html;

/** One `<li id="rule-<id>"><strong>Heading:</strong> body</li>` per item, the body's jargon linked. */
export const rulesListHtml = (items: ReadonlyArray<RuleItem>, glossary: Glossary): string =>
  items
    .map(
      (item) =>
        `<li id="${ruleAnchor(item.id)}"><strong>${item.heading}:</strong> ${linkJargon(item.body, glossary, { except: item.id })}</li>`,
    )
    .join('\n');

/** The rule id a `#rule-<id>` hash names (`location.hash`, with or without the `#`), else null. */
export const ruleFromHash = (hash: string): string | null => {
  const m = /^#?rule-([a-z][a-z0-9-]*)$/.exec(hash);
  return m?.[1] ?? null;
};
