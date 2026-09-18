// Strategy erasure (docs/MIGRATION.md step 8): typed from legacy/fidice/index.html line 880
// (bundle section "// src/bots/strategy.ts"); the strategy shapes are in types.ts.
import type { AnyStrategy, Strategy } from './types.ts';

/**
 * Erase a strategy's memory type so strategies with different memories share one pool
 * (registry.ts). The identity at runtime: only the type changes.
 */
const anyStrategy = <M>(s: Strategy<M>): AnyStrategy => s as AnyStrategy;

export { anyStrategy };
