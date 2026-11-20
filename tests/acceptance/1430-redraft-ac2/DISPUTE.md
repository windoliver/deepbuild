# Dispute: #1430 AC2's first draft holds body text to the role's static family, which #1484 retired

This redraft exists because of this dispute. The first draft is `tests/acceptance/1430/ac2-property.test.ts`, both of its
tests.

## What fails

#1430's AC2 reads: "A property test over random text, fonts, sizes and widths: output from the split cache is byte-equal
to output from an empty cache. A planted key missing the font fails it". Before comparing, the first draft checks each
empty-cache output: every glyph must be set in a face whose family, as `deep-text fonts` lists it, equals its role's
`fonts[].family`.

The first draft was written at `7312c66d2`. #1484 merged on main after it (`a4d0290b5`). It sets a family in its variable
twin where one is bundled (`crates/deep-text/src/fonts.rs`, `shaped_in`). So body text is now set in `InterVariable.ttf`,
family "Inter Variable", while `deep-text fonts` still names the body role's family "Inter". On any program built on a
base with #1484, every body-role case fails that check before the comparison runs. The planted test then can't find the
difference it names, so it fails too. Run once on #1430's work merged with main (Nov 19, 2026):

```
AssertionError: the split cache against an empty cache, seed 1430:
  "r. it's A-Z fjord W.AVE ; Tw Tw" in body at 9 px, 72 px wide: a glyph is ["crates/deep-text/fonts/InterVariable.ttf",9,852,0,9.27392578125], not one of a Inter face at 9 px
  … (12 body-role cases in all; the mono and math cases pass)
AssertionError: the planted key missing the font: a failure matches /^seed 1430, case \d+ of 160 \(.+\): the split cache's output differs from an empty cache's: /
```

The first draft's other files pass on the same work: AC1 2/2 and AC3 2/2. AC4's record checks pass and its times read
INCONCLUSIVE by load.

## How the redraft was made

AC2 went back to the same blind job. It was given the base fact above (#1484's `shaped_in` and what `deep-text fonts`
lists) and the failing message, at a base with #1484 and none of #1430's work (`a4d0290b5`). It read no implementation.
It keeps the first draft's surfaces (`deep-text shape`, `run: true`, `--planted key_without_font`, seed 1430, 160 cases).
It holds each glyph to the family its role is set in: the role's family, or that family's `<family> Variable` twin where
`deep-text fonts` lists one. It passes on #1430's work merged with main (2 tests, one run, Nov 19, 2026):

```
✓ AC2 #1430.c8134c7e over 160 layouts from seed 1430 of random texts, fonts, sizes and widths laid out in turn, each
  output from the split cache is byte-equal to the same layout's output from an empty cache 2938ms
✓ AC2 #1430.c8134c7e the planted key missing the font fails the property, naming the case, its first difference and the
  shrunk cases 1388ms
```

## The swap

`scripts/lanes.mjs` runs this redraft in place of the first draft's `ac2-property.test.ts`, which is kept as written and
runs by hand only. The owner rules on the swap.
