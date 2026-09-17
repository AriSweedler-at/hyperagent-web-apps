# CSS <-> TS class contract

The list of CSS classes and element ids that TypeScript toggles, sets or looks up, and that a
stylesheet or page must therefore provide. `test/dist/class-contract.test.ts` (docs/MIGRATION.md
step 14) fails when a class named in TS has no rule in the built CSS, or a class in this table is
never referenced from TS. Adding a screen or a class means adding a row here first
(docs/ARCHITECTURE.md "Conventions for small diffs").

Nothing is listed yet: step 5 lands the shared modules unconsumed, and the games' classes join
this table as each port (steps 9 and 12) starts toggling them through `web/shared/edge/dom.ts`.

| Owner | Kind | Name | Toggled by (TS) | Styled in (CSS) | Notes |
| ----- | ---- | ---- | --------------- | --------------- | ----- |
|       |      |      |                 |                 |       |

Rules of the table:

- `Kind` is `class`, `id` or `attr` (`hidden`, `disabled`, `aria-*`).
- `Toggled by` names the TS module (`web/games/<g>/src/ui/render.ts`, `web/shared/ui/<x>.ts`).
- `Styled in` names the stylesheet (`web/games/<g>/theme.css`, `web/shared/styles/base.css`).
- A row with an empty `Styled in` is a behaviour-only hook (a test id, an `aria` state) and says so
  in `Notes`.
