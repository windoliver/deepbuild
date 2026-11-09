# Criterion 4, blind redraft

Criterion 4 of #1434: "A planted effect over the question card is refused, the card's pixels are byte-equal to its
render with no effect, and the refusal names the effect and the card." Redrafted blind from the issue,
`docs/technical-design.md`, `docs/canvas-primitives.md`, AGENTS.md, the base `dd83ac2f` and the first draft's surface
(`../README.md`, `../helpers.ts`, `../fixtures/card.json`); no implementation was read. `ac4-card.test.ts` here replaces
`../ac4-card.test.ts`; the fixture is `../fixtures/card.json`, unchanged.

## What changed and why

The first draft's second test switched the guard off (`DEEP_CHROME_PLANT=no_card_guard`) and expected the deferred
`flare`'s frost to change the card's pixels. At the base it can't. `crates/deep-app/src/card.rs` presents the card as
the window's prompt, and `vendor/gpui-pre/src/window.rs`'s `draw_roots` paints the root, then `paint_deferred_draws`,
then the prompt, so the card paints after every deferred draw. The card itself is an opaque `chrome.raised` fill that
fills its slot. An unguarded effect drawn in its element's paint order lands under the card, the card's pixels stay
byte-equal, and that test fails on a correct program. Its reading, that an effect reaches over the card only from a
node painted after it, was wrong too: no node a panel draws paints after the prompt.

So the first test stays as it was: the refusal names `flare`, `frost@1` and `card`; the card's slot is byte-equal to
`--omit-effect flare`'s; the clean render refuses nothing and shows a drawn card. The guard refuses by where the effect
is, over the card's slot, not by when it paints. The second test now plants the wrong program the pixel check exists
for: an effect that escapes its paint order and composites above the card, with nothing refused. That program fails
both of the first test's checks. The test doesn't rely on any paint order the base lacks: the plant is what breaks the
order.

## Tests

| Test | Checks |
|---|---|
| `AC4 the effect is refused, naming the effect and the card, and every pixel of the card equals the window drawn without the effect` | `card.json` drawn as is: a refusal `{effect: "flare", operator: "frost@1", over: "card"}`; every pixel of the card's slot byte-equal to `--omit-effect flare`'s render, which refuses nothing and whose slot isn't one flat color |
| `AC4 a planted program whose effect composites above the card and is not refused (DEEP_CHROME_PLANT=effect_above_card) fails both checks` | The same fixture under the plant: no refusal for `flare`, and at least half of the card slot's pixels differ from `--omit-effect flare`'s (the tint halves red and green wherever it lands) |

## The plant the implementer provides

| Name | Selected by | The wrong program |
|---|---|---|
| `effect_above_card` | `DEEP_CHROME_PLANT=effect_above_card`, read only in a `chrome-fixture` build, as `../README.md`'s plants are | The guard that refuses an effect over the question card or an access prompt is off, so nothing is refused, and every effect slot composites after the window's last paint (after the prompt, so over the question card) instead of in its element's paint order, as an effect drawn in its own pass over the finished frame would be. The slot's output and its clip to its node's rect are otherwise unchanged |

`no_card_guard` from `../README.md` isn't used here. It can't change the card's pixels for the reason above.

## Run

```sh
npx tsc --noEmit -p tests/acceptance/1434/tsconfig.json      # its include covers this folder
npx vitest run --root tests/acceptance/1434 --no-file-parallelism redraft-ac4
```

At the base this file fails at its build, like `../BASE-FAILURE.txt`'s AC4 lines: `deep-replica` has no
`chrome-fixture` feature.
