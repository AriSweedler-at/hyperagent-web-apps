// Flat config for the whole repo; the rule set is specified in docs/ARCHITECTURE.md "eslint.config.js".
// Layers are selected by path globs; the same globs must stay in step with tsconfig.pure.json.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import functional from 'eslint-plugin-functional';
import { createNodeResolver, importX } from 'eslint-plugin-import-x';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

// ---------------------------------------------------------------------------------------------
// Layer globs
// ---------------------------------------------------------------------------------------------
const PURE = [
  'web/shared/lib/**/*.ts',
  // The shared shell's pure helpers (web/shared/ui/glossary.ts first, docs/design/glossary-links.md
  // §3; ids.ts; the shell reducer shell.ts, docs/design/shared-shell.md §4.2). Its painters and
  // binders (shellPaint.ts, curtain.ts, toast.ts, home.ts: they write the document, §4.4; keyed.ts,
  // the keyed slot, dry-round-2.md D1; stories.ts, the stories page, dry-round-2.md I3) are carved
  // out the way scorer/main.ts is below; tsconfig.pure.json excludes the same six. The shell's
  // effect runner (shellEffects.ts) is carved out too: it calls the adapters, statements the pure
  // profile refuses, while staying DOM-free, so tsconfig.pure.json still compiles it.
  'web/shared/ui/!(shellPaint|curtain|toast|home|keyed|shellEffects|stories).ts',
  'web/games/*/src/engine/**/*.ts',
  'web/games/*/src/domain/**/*.ts',
  'web/games/*/src/bots/**/*.ts',
  // gin keeps protocol.ts at src/; fidice's lives at src/net/protocol.ts (docs/MIGRATION.md step 8).
  'web/games/*/src/protocol.ts',
  'web/games/*/src/net/protocol.ts',
  // gin's scorer maths; scorer/main.ts is the Score Counter's screen (docs/MIGRATION.md step 12).
  'web/games/*/src/scorer/!(main).ts',
  // The coin game (dry-round-2.md F3): a two-seat engine held to the engines' profile.
  'web/shared/example/**/*.ts',
  // The shell markup renderer (dry-round-2.md G2: strings in, a Result out) and each shell game's
  // page.ts, the slot values and residue tools/shell-markup.ts composes its index.html from.
  'web/shared/markup/**/*.ts',
  'web/games/*/page.ts',
];
const ALGORITHMS = ['**/*.algorithms.ts'];
const EDGES = [
  'web/**/main.ts',
  'web/**/app/**/*.ts',
  // fidice's peerjs.ts is the PeerJS adapter itself: it holds the deferred Peer (step 9); gin's
  // and backgammon's host.ts/guest.ts are the wrappers over web/shared/net's sessions.
  'web/games/*/src/net/{host,guest,client,session,peerjs}.ts',
  'web/**/view/vdom.ts',
  'web/shared/edge/**/*.ts',
  // The two-seat sessions (classes over the Peer) and the harness beside them (docs/design/shared-shell.md §4.5).
  'web/shared/net/**/*.ts',
  // The shell's toaster and named timers (docs/design/shared-shell.md §4.4): the one shared/ui
  // module that holds state between calls (the Map of armed timers), over an injected Clock.
  'web/shared/ui/toast.ts',
];
// The page boots only: gin's scorer/main.ts is an edge (EDGES) but takes its rng injected.
const RNG_ALLOWED = ['web/games/*/main.ts', 'web/shared/edge/**/*.ts'];
const TESTS_AND_TOOLS = [
  '**/*.test.ts',
  // A game's test scaffolding beside its engine (backgammon's `scripted`, `pos`, `mv`;
  // dry-round-2.md F4): test code by name, like *.test.ts, so it may hold a counter or throw.
  '**/test-helpers.ts',
  'e2e/**/*.ts',
  'tools/**/*.ts',
  'test/**/*.ts',
  '*.config.ts',
];

// ---------------------------------------------------------------------------------------------
// no-restricted-syntax entries
// ---------------------------------------------------------------------------------------------
const LOOP_MESSAGE =
  'no raw loops: use map/filter/reduce/flatMap/Array.from or a named algorithm in *.algorithms.ts';
const loopBans = [
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
].map((selector) => ({ selector, message: LOOP_MESSAGE }));
const erasableSyntaxBans = [
  {
    selector: 'TSEnumDeclaration',
    message: 'enums are not erasable (node --experimental-strip-types); use a union of literals',
  },
  {
    selector: 'TSParameterProperty',
    message: 'parameter properties are not erasable; declare the field and assign it',
  },
  {
    selector: 'TSModuleDeclaration',
    message: 'namespaces are not erasable; use modules',
  },
  { selector: 'LabeledStatement', message: 'no labels' },
];
const absolutePathBan = {
  selector: 'Literal[value=/^\\/(hyperagent-web-apps|shared)\\//]',
  message:
    'no absolute site paths: every URL must be document-relative so both origins resolve it (docs/ARCHITECTURE.md "Two origins")',
};
const mathRandomBan = {
  selector: 'MemberExpression[object.name="Math"][property.name="random"]',
  message: 'inject Rng; Math.random is constructed only in main.ts and web/shared/edge',
};
const dateNowBan = {
  selector: 'MemberExpression[object.name="Date"][property.name="now"]',
  message: 'inject a clock; Date.now is constructed only in main.ts and web/shared/edge',
};
const syntaxBans = [...loopBans, ...erasableSyntaxBans, absolutePathBan];

// ---------------------------------------------------------------------------------------------
// eslint-plugin-functional profiles
// ---------------------------------------------------------------------------------------------
const functionalEverywhere = {
  // Redundant with the no-restricted-syntax loop ban on purpose: two messages, one intent.
  'functional/no-loop-statements': 'error',
  'functional/no-let': ['error', { allowInForLoopInit: false }],
  // ignoreImmediateMutation lets `[...xs].sort()` through.
  'functional/immutable-data': ['error', { ignoreImmediateMutation: true, ignoreClasses: false }],
  // ReadonlyShallow parameters; None for return types and variables keeps inference readable.
  'functional/prefer-immutable-types': [
    'error',
    {
      enforcement: 'None',
      parameters: { enforcement: 'ReadonlyShallow' },
      returnTypes: { enforcement: 'None' },
      variables: { enforcement: 'None' },
    },
  ],
  'functional/type-declaration-immutability': [
    'error',
    { rules: [{ identifiers: '.+', immutability: 'ReadonlyShallow', comparator: 'AtLeast' }] },
  ],
  'functional/prefer-property-signatures': 'error',
  'functional/readonly-type': ['error', 'generic'],
  // OFF, with reasons:
  // the owner asked for no raw loops, not no branches; early returns beat nested ternaries in reducers
  'functional/no-conditional-statements': 'off',
  // bans zero-arity thunks that DOM callbacks need
  'functional/functional-parameters': 'off',
  // collides with unbound-method and hurts stack traces
  'functional/prefer-tacit': 'off',
  // VNode and deps records mix data and callbacks legitimately
  'functional/no-mixed-types': 'off',
  // ICE and transport loaders reject
  'functional/no-promise-reject': 'off',
};

const functionalPure = {
  'functional/no-throw-statements': 'error',
  'functional/no-try-statements': 'error',
  'functional/no-classes': 'error',
  'functional/no-this-expressions': 'error',
  // error from the start and never downgraded: `--max-warnings 0` would fail on a warning anyway,
  // and the ported pure code (docs/MIGRATION.md steps 8 and 10) never needed the warn-plus-ratchet
  // fallback the plan held in reserve (docs/ARCHITECTURE.md "Deviations", step 1 follow-up).
  'functional/no-expression-statements': ['error', { ignoreVoid: true }],
  'functional/no-return-void': 'error',
};

const functionalEdgeRelaxed = {
  'functional/no-classes': 'off',
  'functional/no-this-expressions': 'off',
  'functional/no-let': 'off',
  'functional/immutable-data': 'off',
  'functional/no-expression-statements': 'off',
  'functional/no-return-void': 'off',
  'functional/no-throw-statements': 'off',
  'functional/no-try-statements': 'off',
};

const functionalOff = Object.fromEntries(
  Object.keys(functional.rules).map((name) => [`functional/${name}`, 'off']),
);

// ---------------------------------------------------------------------------------------------
// Module boundaries (docs/ARCHITECTURE.md "Module boundaries and contracts"). `from` entries are
// plain paths with `except` relative to them, or all globs with glob `except`s: the rule forbids
// mixing. Zones for layers that do not exist yet are inert until those folders land.
// ---------------------------------------------------------------------------------------------
const GAME_SRC = './web/games/*/src';
// Both protocol modules (see PURE above); they leave the net/ zone and join the protocol zone.
const PROTOCOL = [`${GAME_SRC}/protocol.ts`, `${GAME_SRC}/net/protocol.ts`];
// The games, spelled here too because this file is plain JavaScript (tools/games.ts is the typed
// registry): one zone per ordered pair keeps every game out of every other.
const GAMES = ['gin-rummy', 'fidice', 'backgammon', 'briscola'];
const gamePairZones = GAMES.flatMap((target) =>
  GAMES.filter((from) => from !== target).map((from) => ({
    target: `./web/games/${target}`,
    from: `./web/games/${from}`,
    message: 'games never import each other.',
  })),
);
const zones = [
  {
    target: './web/shared/lib',
    from: './web',
    except: ['./shared/lib'],
    message: 'web/shared/lib is a leaf layer: it may import only itself.',
  },
  {
    target: './web/shared',
    from: './web/games',
    message: 'shared code never imports a game.',
  },
  {
    // The shared shell's ui/ (docs/design/glossary-links.md §3, shared-shell.md §4.1): the reach of
    // a game's ui/ zone below, web/shared/lib and the DOM edge with its fakes, nothing else. The
    // clock fake is for toast.ts's test alone (§4.4: the toaster and the timers take their Clock
    // injected, so the module imports only the type from web/shared/lib/clock.ts).
    target: './web/shared/ui',
    from: ['./web/shared/edge/**', './web/shared/net/**', './web/shared/styles/**'],
    except: [
      '**/web/shared/edge/dom.ts',
      '**/web/shared/edge/dom.fake.ts',
      '**/web/shared/edge/page.fake.ts',
      '**/web/shared/edge/clock.fake.ts',
    ],
    message: 'web/shared/ui imports web/shared/lib, the DOM edge and the clock fake only.',
  },
  {
    // The shell markup renderer (dry-round-2.md G2): strings in, a Result out; it reads no file
    // (tools/shell-markup.ts does) and no document.
    target: './web/shared/markup',
    from: [
      './web/shared/edge/**',
      './web/shared/net/**',
      './web/shared/ui/**',
      './web/shared/styles/**',
    ],
    message: 'web/shared/markup imports web/shared/lib only.',
  },
  {
    // A shell game's page.ts is data for tools/shell-markup.ts: its slot values and the residue
    // blocks of its index.html, typed by web/shared/markup/shell.ts and importing nothing else.
    target: './web/games/*/page.ts',
    from: [
      './web/shared/edge/**',
      './web/shared/net/**',
      './web/shared/ui/**',
      './web/shared/lib/**',
      './web/shared/example/**',
      './web/shared/styles/**',
      `${GAME_SRC}/**`,
    ],
    message: 'page.ts imports only the ShellPage types from web/shared/markup.',
  },
  ...gamePairZones,
  {
    target: [`${GAME_SRC}/engine/**`, `${GAME_SRC}/domain/**`, `${GAME_SRC}/bots/**`],
    from: [
      './web/shared/edge/**',
      `${GAME_SRC}/net/**`,
      `${GAME_SRC}/ui/**`,
      `${GAME_SRC}/view/**`,
      `${GAME_SRC}/app/**`,
      `${GAME_SRC}/scorer/**`,
      `${GAME_SRC}/protocol.ts`,
      `${GAME_SRC}/storage.ts`,
      './web/games/*/main.ts',
    ],
    message: 'the pure core imports only web/shared/lib and its siblings.',
  },
  {
    target: PROTOCOL,
    from: [
      './web/shared/edge/**',
      `${GAME_SRC}/net/**`,
      `${GAME_SRC}/ui/**`,
      `${GAME_SRC}/view/**`,
      `${GAME_SRC}/app/**`,
      `${GAME_SRC}/scorer/**`,
      `${GAME_SRC}/storage.ts`,
    ],
    message: 'protocol.ts imports only engine/domain types and web/shared/lib.',
  },
  {
    // Every scorer/ module except scorer/main.ts, the Score Counter's screen (an edge), and the
    // tests beside them (scorer/main.test.ts drives the screen on the page fake).
    target: [`${GAME_SRC}/scorer/!(main|*.test).ts`],
    from: [
      './web/shared/edge/**',
      `${GAME_SRC}/net/**`,
      `${GAME_SRC}/ui/**`,
      `${GAME_SRC}/view/**`,
      `${GAME_SRC}/app/**`,
      `${GAME_SRC}/protocol.ts`,
      `${GAME_SRC}/storage.ts`,
      './web/games/*/main.ts',
    ],
    message: 'scorer maths imports only engine types and web/shared/lib.',
  },
  {
    // Every net/ module except protocol.ts, which the zone above owns.
    target: [`${GAME_SRC}/net/!(protocol).ts`, `${GAME_SRC}/net/*/**`],
    from: [
      './web/shared/edge/**',
      `${GAME_SRC}/ui/**`,
      `${GAME_SRC}/view/**`,
      `${GAME_SRC}/app/**`,
      `${GAME_SRC}/storage.ts`,
    ],
    // The two fakes are for the session tests beside the modules (docs/MIGRATION.md step 12);
    // peer.ts is the peer plumbing every game's sessions share (watchdog, keep-alive, path toast);
    // web/shared/net holds the two-seat sessions a game's host.ts/guest.ts wrap and the harness its
    // sessions.test.ts drives them with (docs/design/shared-shell.md §4.5).
    except: [
      '**/web/shared/edge/transport.ts',
      '**/web/shared/edge/transport.fake.ts',
      '**/web/shared/edge/clock.ts',
      '**/web/shared/edge/clock.fake.ts',
      '**/web/shared/edge/peer.ts',
      '**/web/shared/net/**',
    ],
    message: 'net/ imports protocol, engine/domain and only the transport, clock and peer edges.',
  },
  {
    // The shared two-seat sessions (docs/design/shared-shell.md §4.5): the same reach as a game's
    // net/ zone above, with the game itself injected (the codec and `game`), never imported (the
    // './web/shared' zone refuses that).
    target: ['./web/shared/net/**'],
    from: ['./web/shared/edge/**', './web/shared/ui/**', './web/shared/styles/**'],
    except: [
      '**/web/shared/edge/transport.ts',
      '**/web/shared/edge/transport.fake.ts',
      '**/web/shared/edge/clock.ts',
      '**/web/shared/edge/clock.fake.ts',
      '**/web/shared/edge/peer.ts',
    ],
    message: 'web/shared/net imports web/shared/lib and only the transport, clock and peer edges.',
  },
  {
    // Every ui/ module except ui/state.ts, which the reducer zone below owns, and the tests beside
    // them, which reach the fakes and the layers their module wires (docs/MIGRATION.md step 12).
    target: [`${GAME_SRC}/ui/!(state|*.test).ts`, `${GAME_SRC}/ui/*/**`, `${GAME_SRC}/view/**`],
    from: [
      './web/shared/edge/**',
      `${GAME_SRC}/net/**`,
      `${GAME_SRC}/app/**`,
      `${GAME_SRC}/storage.ts`,
    ],
    // dom.fake.ts is the structural DOM the view tests render into (docs/MIGRATION.md step 9);
    // page.fake.ts the static-page fake the gin ui/page.fake.ts fixture builds on (step 12);
    // drag.ts the pointer-drag kernel both games' draggers configure (dry-round-2.md E1);
    // motion.ts the glide and the flight gin's hand/flip.ts and backgammon's board/fly.ts run (E2).
    except: [
      '**/web/shared/edge/dom.ts',
      '**/web/shared/edge/dom.fake.ts',
      '**/web/shared/edge/page.fake.ts',
      '**/web/shared/edge/drag.ts',
      '**/web/shared/edge/motion.ts',
    ],
    message: 'ui/ and view/ render views; DOM access only through @shared/edge/dom.',
  },
  {
    // The reducer is imported by main.ts, the tests and the three gin painters that paint the App
    // and dispatch its Intents (render, home, local: types and the screen/tab lists only,
    // docs/ARCHITECTURE.md step 12 deviations); every other ui/ or view/ module is refused.
    target: [
      `${GAME_SRC}/ui/!(state|render|home|local|*.test).ts`,
      `${GAME_SRC}/ui/*/**`,
      `${GAME_SRC}/view/**`,
    ],
    from: [`${GAME_SRC}/ui/state.ts`, `${GAME_SRC}/app/controller.ts`],
    message: 'ui/state.ts is imported only by main.ts, tests and the painters render/home/local.',
  },
  {
    // Reducers over intents: "everything below" in the boundary table, so only the edges and
    // main.ts are off limits (main.ts constructs the adapters and injects them). A game's
    // shellConfig.ts (docs/design/shared-shell.md §4.3: the half of its shell config spelled from
    // its engine, protocol and storage) has the reducer's reach.
    target: [
      `${GAME_SRC}/ui/state.ts`,
      `${GAME_SRC}/app/controller.ts`,
      `${GAME_SRC}/shellConfig.ts`,
    ],
    from: ['./web/shared/edge/**', './web/games/*/main.ts'],
    message:
      'ui/state.ts and app/controller.ts import everything below them, never an edge or main.ts.',
  },
  {
    target: [`${GAME_SRC}/storage.ts`, `${GAME_SRC}/app/effects.ts`],
    from: [
      './web/shared/edge/**',
      `${GAME_SRC}/net/**`,
      `${GAME_SRC}/ui/**`,
      `${GAME_SRC}/view/**`,
    ],
    // prefs.ts is the shell's shared readers and writers over a Store (docs/design/shared-shell.md
    // §5 A3): a game's storage.ts builds its own from them over the keys it alone names.
    except: ['**/web/shared/edge/storage.ts', '**/web/shared/edge/prefs.ts'],
    message:
      'storage modules import only web/shared/lib, @shared/edge/storage and @shared/edge/prefs.',
  },
];

export default defineConfig([
  globalIgnores(
    [
      'legacy/**',
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      // Generated by tools/legacy/extract-*.ts; the manifest test beside them is linted.
      'test/fixtures/legacy/*.cjs',
      '.wrangler/**',
    ],
    'ignores',
  ),

  // --- TypeScript base: type-aware strict + stylistic for every .ts file ---------------------
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { requireDefaultForNonUnion: true },
      ],
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      // stylisticTypeChecked prefers `readonly T[]`; functional/readonly-type is set to `generic`
      // (ReadonlyArray<T>, Readonly<...>). Align the two so a file cannot satisfy one and fail the other.
      '@typescript-eslint/array-type': ['error', { default: 'array', readonly: 'generic' }],
      'prefer-const': 'error',
      'no-var': 'error',
      'no-param-reassign': ['error', { props: true }],
      'no-restricted-syntax': ['error', ...syntaxBans, mathRandomBan],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'peerjs',
              message: 'only web/shared/edge/transport.ts imports peerjs; inject a Transport.',
            },
          ],
        },
      ],
    },
  },
  {
    files: RNG_ALLOWED,
    rules: { 'no-restricted-syntax': ['error', ...syntaxBans] },
  },
  {
    // The pure layers take their clock by injection too (docs/MIGRATION.md step 10: the gin
    // engine's `Now`); tests beside them may read the real clock.
    files: PURE,
    ignores: ['**/*.test.ts'],
    rules: { 'no-restricted-syntax': ['error', ...syntaxBans, mathRandomBan, dateNowBan] },
  },
  {
    files: ['web/shared/edge/transport.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // The games.sweedler.com Worker is the one place that spells the site's absolute paths: it
    // maps them between the two origins (docs/ARCHITECTURE.md "Two origins"). Its table tests
    // list them too. The other bans stay.
    files: ['infra/games-proxy/**/*.ts'],
    rules: { 'no-restricted-syntax': ['error', ...loopBans, ...erasableSyntaxBans, mathRandomBan] },
  },
  {
    // Ambient declarations (web/raw-imports.d.ts) are never executed, so the erasable-syntax ban on
    // `declare module` does not apply; the other bans stay.
    files: ['web/**/*.d.ts'],
    rules: { 'no-restricted-syntax': ['error', ...loopBans, absolutePathBan, mathRandomBan] },
  },

  // --- eslint-plugin-functional profiles ------------------------------------------------------
  {
    // Every shipped .ts: the site under web/ and the games.sweedler.com Worker.
    files: ['web/**/*.ts', 'infra/games-proxy/**/*.ts'],
    ignores: ['**/*.test.ts'],
    plugins: { functional },
    rules: functionalEverywhere,
  },
  {
    files: PURE,
    ignores: ['**/*.test.ts'],
    plugins: { functional },
    rules: functionalPure,
  },
  {
    // The only files where loops, `let` and local mutation are allowed; each export says why.
    files: ALGORITHMS,
    plugins: { functional },
    rules: {
      'no-restricted-syntax': [
        'error',
        ...erasableSyntaxBans,
        absolutePathBan,
        mathRandomBan,
        dateNowBan,
      ],
      'functional/no-loop-statements': 'off',
      'functional/no-let': 'off',
      'functional/immutable-data': 'off',
      'functional/prefer-immutable-types': 'off',
      // "local mutation" is an assignment statement; without this the two lines above grant
      // nothing usable (verified on web/shared/lib/rng.algorithms.ts in step 2). Calls with
      // side effects stay banned by the pure profile's no-return-void and the readonly types.
      'functional/no-expression-statements': 'off',
    },
  },
  {
    // Edges keep the loop ban and readonly types but may hold state and talk to the world.
    files: EDGES,
    plugins: { functional },
    rules: functionalEdgeRelaxed,
  },
  {
    // Tests, e2e, tools and config files: strictTypeChecked only.
    files: TESTS_AND_TOOLS,
    plugins: { functional },
    rules: { ...functionalOff, 'no-console': 'off' },
  },

  // --- Module boundaries ----------------------------------------------------------------------
  {
    files: ['**/*.ts'],
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver-next': [
        createNodeResolver({ extensions: ['.ts', '.js', '.mjs', '.cjs', '.json'] }),
      ],
      // Without this, no-cycle only follows .js dependencies and a .ts cycle goes unreported.
      'import-x/extensions': ['.ts', '.js', '.mjs', '.cjs'],
    },
    rules: {
      'import-x/no-cycle': 'error',
      'import-x/no-self-import': 'error',
      'import-x/no-restricted-paths': ['error', { zones }],
    },
  },

  // --- Plain JavaScript: no type-aware rules. What is left after docs/MIGRATION.md step 15:
  // infra/turn-worker/worker.js (deployed by hand, unchanged), the page-side harness scripts
  // e2e/browser/*.js and test/integration/harness.js, the .mjs registry shim under
  // .github/actions, and this config. Nothing under web/ or infra/games-proxy/ is JavaScript.
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        Request: 'readonly',
        Response: 'readonly',
        Headers: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        console: 'readonly',
        globalThis: 'readonly',
      },
    },
    rules: {
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  // --- Page-side init scripts the Playwright harness injects (e2e/browser/*.js) -------------
  {
    files: ['e2e/browser/**/*.js'],
    languageOptions: { globals: { window: 'readonly' } },
  },

  // Prettier formats; this disables every rule that would fight it. Must stay last.
  prettier,
]);
