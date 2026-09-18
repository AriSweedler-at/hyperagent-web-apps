// Redaction (docs/MIGRATION.md step 8): typed from legacy/fidice/index.html lines 862-877 (bundle
// section "// src/domain/publicState.ts"); behaviour is unchanged, test/parity/fidice.legacy.test.ts
// is the oracle. `redactFor` is the only way a State leaves the host: dice under a cup the viewer
// may not see become null.
import { holderMaySee } from './game.ts';
import type { PublicRound, PublicState, State, Viewer } from './types.ts';

const canSeeCup = (s: State, viewer: Viewer): boolean => {
  if (viewer.kind === 'spectator' || s.reveal) return true;
  const r = s.round;
  return r !== null && viewer.seat === r.holder && holderMaySee(r);
};

const redactFor = (s: State, viewer: Viewer): PublicState => {
  const seeCup = canSeeCup(s, viewer);
  const round = s.round && {
    ...s.round,
    dice: s.round.dice.map((d) => ({ inCup: d.inCup, value: d.inCup && !seeCup ? null : d.value })),
  };
  const {
    code,
    lives,
    phase,
    players,
    spectators,
    roundNo,
    reveal,
    winner,
    log,
    records,
    hostSeat,
    autoNextAt,
  } = s;
  return {
    code,
    lives,
    phase,
    players,
    spectators,
    roundNo,
    round,
    reveal,
    winner,
    log,
    records,
    hostSeat,
    autoNextAt,
  };
};

const publicCupIndices = (r: PublicRound): ReadonlyArray<number> =>
  r.dice.flatMap((d, i) => (d.inCup ? [i] : []));
const publicTableIndices = (r: PublicRound): ReadonlyArray<number> =>
  r.dice.flatMap((d, i) => (d.inCup ? [] : [i]));

export { canSeeCup, redactFor, publicCupIndices, publicTableIndices };
