# Language packs: one vocabulary of cards, many names, a choice per game

The sound-font pattern (docs/design/sound-fonts.md) and the card-pack pattern (docs/design/card-packs.md)
applied to what a card is called. The owner (2026-09-25): "there should be a subtle tooltip when
you hover a card. like 're di denari'. That's the italian language pack. but with the english
language pack, it would be 'ace of plates'. Language packs are just like card packs or soundfonts."
Then: "when a card is on the table, the tooltip should show. But not as a tooltip, instead, it
should show on the table. Sometimes it is a little bit tough to read the cards because their suits
are not familiar to the american audience." And: "If you hover the briscola card, it wiggles outta
the deck a little bit. Clicking on it lets you see it in a fullscreen display."

## 1. The shape (`web/shared/lib/lang/packs.ts`)

```ts
LANGUAGE_PACKS = ['it', 'en', 'en-plates']
DeckWords = { suits: Record<suit id, word>, ranks: Record<rank id, word>, join: string }   // `${rank} ${join} ${suit}`
LanguagePack = { name, label, decks: Partial<Record<DeckKind, DeckWords>>, notes? }
langByName, isLanguagePack, resolveLang(value, fallback), badLanguageMsg(key, value)
cardName(pack, kind, id)   // "re di denari" | "king of coins" | "ace of spades" | null for a stranger
```

| Pack        | `italian40`                                            | `french52`                                  |
| ----------- | ------------------------------------------------------ | ------------------------------------------- |
| `it`        | coppe denari spade bastoni; asso … sette fante cavallo re; "di" | picche cuori quadri fiori; asso … dieci fante donna re; "di" |
| `en`        | cups coins swords batons; ace … seven knave knight king; "of"  | spades hearts diamonds clubs; ace … ten jack queen king; "of" |
| `en-plates` | `en` with **plates** for denari                        | `en`'s                                      |

Every shipped pack names every card of both deck kinds (packs.test.ts); a pack that lacks a kind, or
a word, falls back card by card to the deck's own language (`DECKS[kind].name`, what a picture's
`alt` has always said), silently, the way a card pack missing one picture draws the glyph.

**Coins or plates.** English has three words for denari (coins, plates, money). `en` says `coins`,
the word of the card literature and of decks.ts's `english` field; the owner's word is `plates`, so
`en-plates` ships beside it as `en` with that one word changed, and `en`'s `notes` says so.

## 2. Choosing a pack: per game, no conflicts

| Game     | Key             | Default | Hook                                        |
| -------- | --------------- | ------- | ------------------------------------------- |
| briscola | `briscola_lang` | `it`    | `__briscola.lang(name)` / `langName()`      |

`web/shared/edge/prefs.ts` has `decodeLanguagePack` and `langPref(key, defaultName)`: a `TextPref`
plus `orDefault(store)`, the game's default when the key is missing or unreadable, so `home.read`
never logs. The flow is the card pack's: `App.table.lang` read at `home/init`, `lang/set` to change
it, `writeLang` to remember it, the boot logging `badLanguageMsg` for a stored stranger and dropping
it, the console hook refusing a stranger with the same line. Gin keeps no key yet: its faces are
named by no pack (its 52 pins stay byte for byte).

## 3. The face (`web/shared/ui/cardFace.ts`)

`faceHtml(spec, { extra, name, title })`: with a `name` the box carries `role="img"
aria-label="<name>"` (a picture's alt is replaced), and `title="<name>"` too when `title` is asked,
for a game with no tooltip of its own. Without a name the markup is what it was, byte for byte.

## 4. Adding a pack

A file under `packs/` (`as const satisfies LanguagePack`), its name in `LANGUAGE_PACKS`, its row in
`PACKS`; packs.test.ts checks it names every card of every deck kind it speaks, no two alike.

## 5. Briscola's binding

- **Captions.** Every play of the trick carries a `.card-name` span after its `.who` chip, and the
  briscola under the stock has `#briscolaName` after the stock's count: one quiet cream line in the
  chosen language, cut with an ellipsis where the card is narrower than the name. The centre band
  grew 16px for it (`.table-center` a mid card + 46, `.trick` + 40; the phone's height budget 576,
  the desktop's 542, the scroll fallbacks at 638 and 627; ui/layout.ts `BAND_EXTRA` 46 and the
  chrome budgets are the twin). At two players the two plays sit 24px apart so a name may be wider
  than its card.
- **Tip.** `#cardTip` (body level, fixed, a low-contrast pill, no arrow) over a hand card: a fine
  pointer's `pointerover` arms `tip/arm` (shown after `TIP_HOVER_MS` 400 by the shell's `tip`
  timer), `pointerout` or a press hides it; a touch `pointerdown` arms it as a long press
  (`TIP_PRESS_MS` 450) and the lift hides it, swallowing the click it fires (`swallowTap`) so the
  card is not lifted. Never under the curtain, never over another seat's back: the binder reads
  `#hand` alone and refuses `hidden-cards`; the reducer refuses a card not in my hand.
- **The briscola.** Under `(hover: hover) and (pointer: fine)` the trump card slides 8px further out
  of the stock and tilts 3° on hover (transform alone, the card's 160ms, reduced motion's 1ms); a
  tap on it (`exchange/click`) is the exchange while offered (D24), else `cardView/open` for the
  trump card: `#cardViewOverlay`, the shell's sheet idiom, shows the face at 240px through the pack
  with its name beneath; close, backdrop, Escape and `cardView/close` put it away. No game state
  changes.
- **Labels.** Every face the table paints through `lang` carries the name as `aria-label`.
