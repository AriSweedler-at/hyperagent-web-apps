# Briscola: the design

The fourth game: plain briscola for 2, 3 and 4 players, the first game built on the shared shell as
a `shellConfig`, with Italian card packs chosen the way sound fonts are. The consolidated design
(the decisions D1–D24, the rules as engine requirements, the card-pack mechanism, the N-seat
sessions, the table screen and the PR plan) lands with PR-4, the page. Until then this file is the
pointer: what has landed and where its register is.

| PR | What | Register |
|---|---|---|
| PR-2 (landed) | `web/games/briscola/src/engine/`: the rules E1–E26 over 2, 3 and 4 seats, the per-seat views, the byte-stable decoders, the 63 test positions and the seeded replay; the `briscola` vitest suite | `docs/design/briscola-rules.md` |
| PR-1 | Card packs (`web/shared/lib/cards/`, `web/shared/ui/cardFace.ts`, `tools/card-packs.ts`); gin's four backs become back-only packs | `docs/design/card-packs.md` (with PR-1) |
| PR-3 | `HostSession` over N seats; the two-seat games byte-identical | `docs/design/n-seat-sessions.md` (with PR-3) |
| PR-4 | The page on the shared shell: pass-and-play for 2, 3 and 4; online for 2 | `docs/design/briscola-table.md` and this document in full (with PR-4) |
| PR-5 | Online for 3 and 4 players over N seats | (with PR-5) |

Words: *briscola* is the trump suit and the card turned up to name it (the docs say "the trump
card" for the card); a *trick* is a *mano*; a *game* is one deal of 120 points; a *match* is games
to a target. Seats are `0..n-1`, the host is seat 0, play runs to the next seat index; with four
the even seats are one side.
