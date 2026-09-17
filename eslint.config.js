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
  'web/games/*/src/engine/**/*.ts',
  'web/games/*/src/domain/**/*.ts',
  'web/games/*/src/bots/**/*.ts',
  // gin keeps protocol.ts at src/; fidice's lives at src/net/protocol.ts (docs/MIGRATION.md step 8).
  'web/games/*/src/protocol.ts',
  'web/games/*/src/net/protocol.ts',
];
const ALGORITHMS = ['**/*.algorithms.ts'];
const EDGES = [
  'web/**/main.ts',
  'web/**/app/**/*.ts',
  'web/games/*/src/net/{host,guest,client,session}.ts',
  'web/**/view/vdom.ts',
  'web/shared/edge/**/*.ts',
];
const RNG_ALLOWED = ['web/**/main.ts', 'web/shared/edge/**/*.ts'];
const TESTS_AND_TOOLS = [
  '**/*.test.ts',
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
  // error from the start: `--max-warnings 0` would fail on a warning anyway, and no pure module
  // exists yet to ratchet. docs/MIGRATION.md step 8 may downgrade this to warn behind a ratchet on
  // the count if the ported legacy code needs it (docs/ARCHITECTURE.md "Deviations").
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
    target: './web/games/gin-rummy',
    from: './web/games/fidice',
    message: 'games never import each other.',
  },
  {
    target: './web/games/fidice',
    from: './web/games/gin-rummy',
    message: 'games never import each other.',
  },
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
      `${GAME_SRC}/storage.ts`,
    ],
    message: 'protocol.ts imports only engine/domain types and web/shared/lib.',
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
    except: [
      '**/web/shared/edge/transport.ts',
      '**/web/shared/edge/transport.fake.ts',
      '**/web/shared/edge/clock.ts',
    ],
    message: 'net/ imports protocol, engine/domain and only the transport and clock edges.',
  },
  {
    // Every ui/ module except ui/state.ts, which the reducer zone below owns.
    target: [`${GAME_SRC}/ui/!(state).ts`, `${GAME_SRC}/ui/*/**`, `${GAME_SRC}/view/**`],
    from: [
      './web/shared/edge/**',
      `${GAME_SRC}/net/**`,
      `${GAME_SRC}/app/**`,
      `${GAME_SRC}/storage.ts`,
    ],
    except: ['**/web/shared/edge/dom.ts'],
    message: 'ui/ and view/ render views; DOM access only through @shared/edge/dom.',
  },
  {
    // Reducers over intents: "everything below" in the boundary table, so only the edges and
    // main.ts are off limits (main.ts constructs the adapters and injects them).
    target: [`${GAME_SRC}/ui/state.ts`, `${GAME_SRC}/app/controller.ts`],
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
    except: ['**/web/shared/edge/storage.ts'],
    message: 'storage modules import only web/shared/lib and @shared/edge/storage.',
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
      // Root legacy pages and their shared asset: byte-frozen until docs/MIGRATION.md step 4
      // moves them under legacy/.
      'games/**',
      'shared/**',
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
    files: ['web/shared/edge/transport.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },

  // --- eslint-plugin-functional profiles ------------------------------------------------------
  {
    files: ['web/**/*.ts'],
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
      'no-restricted-syntax': ['error', ...erasableSyntaxBans, absolutePathBan, mathRandomBan],
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
    files: ['**/*.ts', '**/*.js'],
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

  // --- Plain JavaScript (Cloudflare Workers under infra/, this config): no type-aware rules ---
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

  // Prettier formats; this disables every rule that would fight it. Must stay last.
  prettier,
]);
