// Rng is the injected source of randomness for engines, bots and sessions (docs/ARCHITECTURE.md
// "Module boundaries"): `Math.random` is constructed only in main.ts and web/shared/edge; tests,
// parity replays and `window.__rng` pass a seeded mulberry32 so every run is reproducible.

export type Rng = () => number;

export { mulberry32 } from './rng.algorithms.ts';
