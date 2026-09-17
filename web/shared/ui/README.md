# web/shared/ui

Reserved (docs/ARCHITECTURE.md "Seams reserved for the roadmap"). Nothing is implemented in
step 5; the folder exists so the module boundaries and the class contract have a home to name.

What lands here later, and where it comes from:

| Module         | Contract                                                                      | Source                                            |
| -------------- | ----------------------------------------------------------------------------- | ------------------------------------------------- |
| `HandView.ts`  | `HandView { render(model, selection): string }`, the only way a hand is drawn | gin `ui/hand/HandView.ts` (step 11)               |
| `toast.ts`     | `toast(root, text, ms)` builder over `@shared/edge/dom` and a `Clock`         | gin `toast()` / fidice toast view (after step 13) |
| `nameEntry.ts` | name form builder (`Ari` / `Jeff` defaults preserved per game)                | both pages' home screens (after step 13)          |
| `lobby.ts`     | room-code display and join form over `@shared/lib/roomCode`                   | both pages (after step 13)                        |
| `base.css`     | generic primitives both games already share, values unchanged                 | step 14                                           |

Rules that will apply: builders return `SafeHtml` or write through `@shared/edge/dom` only; no
`peerjs`, no `localStorage`, no timers except through an injected `Clock`; every class they toggle
is a row in `web/shared/styles/CONTRACT.md`.
