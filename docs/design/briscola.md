# Briscola: the design

The fourth game: plain briscola for 2, 3 and 4 players, the first game built on the shared shell as
a `shellConfig`, with Italian card packs chosen the way sound fonts are. The consolidated design
(the decisions D1–D24, the rules as engine requirements, the card-pack mechanism, the N-seat
sessions, the table screen and the PR plan) lands with PR-4, the page. Until then this file is the
pointer: what has landed and where its register is.

| PR | What | Register |
|---|---|---|
| PR-2 (landed) | `web/games/briscola/src/engine/`: the rules E1–E26 over 2, 3 and 4 seats, the per-seat views, the byte-stable decoders, the 63 test positions and the seeded replay; the `briscola` vitest suite | `docs/design/briscola-rules.md` |
| PR-1 (landed) | Card packs (`web/shared/lib/cards/`, `web/shared/ui/cardFace.ts`, `tools/card-packs.ts`); gin's four backs become back-only packs | `docs/design/card-packs.md` (with PR-1) |
| PR-3 (landed) | `HostSession` over N seats; the two-seat games byte-identical | `docs/design/n-seat-sessions.md` (with PR-3) |
| PR-4 (landed) | The page on the shared shell: pass-and-play for 2, 3 and 4; online for 2; the first `bootShell(cfg)` game | `docs/design/briscola-board.md` (the table screen and its shell), `docs/design/briscola-sound-history.md` (the event stream, the trick sounds, the history panel) |
| PR-5 | Online for 3 and 4 players over N seats | (with PR-5) |

Words: *briscola* is the trump suit and the card turned up to name it (the docs say "the trump
card" for the card); a *trick* is a *mano*; a *game* is one deal of 120 points; a *match* is games
to a target. Seats are `0..n-1`, the host is seat 0, play runs to the next seat index; with four
the even seats are one side.

## The program, in one paragraph

One event, two outputs. The engine resolves a trick, a deal, an exchange or a result once and
appends one `GameEvent {id, kind, seat, at, data}` to `State.events` (the `trick` event carries the
facts the sounds and the history both read: the value class of the points, the class of the card
that took it, `briscola`, `steal`, `overtrump`, `carichiLost`, `drew`, `trumpTaken`); `viewFor`
carries every event into the `View` (they are all public); the reducer's `rendered(app, prev)` finds
the events new since the last paint (`newEvents`, keyed on the last event id so a re-sent frame
plays nothing) and hands each to `phraseOf(event, me, role)` (`src/ui/sound.ts`), the pure binding
from an event to a phrase of qualified cue ids (`good.trick.briscola.steal.big` resolves down its
ladder to whatever the font voices, the default font's `good`), played as one `fx` effect with its
haptic; and the history panel (`src/ui/history.ts`) paints the same `events` as one `<details>` row
each, `summaryOf`/`detailOf` from the engine's `log.ts`, keyed on the match and the last event so
open rows survive a repaint. The mechanism, the table of phrases, the event types and the panel's
markup are `docs/design/briscola-sound-history.md` (§3 the shared mechanism, §4 briscola's table,
§5 the event stream, §6 the panel); the table screen, its CSS, interaction, accessibility,
testability and registration are `docs/design/briscola-board.md`; the rules as engine requirements
are `docs/design/briscola-rules.md`; the card packs are `docs/design/card-packs.md`; the N-seat
sessions are `docs/design/n-seat-sessions.md`.

Corrected at implementation (the page): `briscola-table.md` was folded into `briscola-board.md`
(backgammon's name for the same document); the default pack on `main` at the landing is
`napoletane` (D12's `bergamasche` sheet was not cut), with `linea` the procedural fallback and the
goldens' pack, and `american` gin's French faces relabelled; the phone topbar takes backgammon's
menu (`#menuBtn`, the rules and history buttons desktop-only) because two badges and four 44 px
buttons do not fit 390 px; the card classes are `web/shared/ui/cardFace.ts`'s (`face glyph rank br
suit suit-C…`), not §5.7's `idx`/`suit-coppe`; the four-player fan overlaps 0.45, not 0.6; 375 × 667
fits without a scroll (the floors are 622 px on the phone and 611 px on the desktop).
