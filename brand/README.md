# DeepBuild logo guidelines

**The idea.** A D whose counter holds a keyframe. The keyframe is the motion editor's own symbol: the point where something is set exactly, and everything between two of them moves on its own. DeepBuild's agents make 2D motion, figures, 3D scenes and films as data, and the app checks them before you see them. The mark is the name's initial with that one exact point inside it.

## Construction

`build.py` generates all the geometry from rectangles, rounded rectangles, circular arcs and squares standing on their points. Fills use nonzero winding: solids clockwise, holes counter-clockwise. `construction-keyframe.svg` shows the guides.

| Part | Rule (256-unit box, 8-unit grid) |
|---|---|
| D | Stem, bars and bowl are all 42 thick. The outer bowl has radius 92 and the counter radius 50, both centred at (120, 128). The stem runs from x 44 to 86, and the D from y 36 to 220. |
| Keyframe | A square on its point with radius 28, centred at (130, 128) on the counter's centroid, so it sits 16 from the stem and 12 from the bowl. |
| Reversed | Every edge moves 0.75 in, and the keyframe's radius becomes 27.25, so light on dark looks as heavy as ink on light. |
| Small cut | For 24 px and below, on a 16-unit grid: stem and bowl 3, counter radius 3, keyframe radius 2, each with a 1-unit gap. Every straight edge lands on a pixel at 16 px. |

## Wordmark

The wordmark is drawn, never typeset:
- **Metrics:** cap height 100, x-height 72, strokes 18, and 16 for the e's bar and the B's middle bar.
- **Round letters:** bowls of radius 37 with counters of radius 19, overshooting by 1.
- **The e:** opens between its bar and 40° below the horizontal.
- **The B:** its lower bowl is 6 units wider than the upper.
- **The i:** its dot is a small keyframe (radius 12). It's Signal yellow in the colour artwork, and the letters' colour everywhere else.
- **Spacing:**

  | Pair | Spacing |
  |---|---|
  | Straight to straight | 18 |
  | Straight to round | 12 to 15 |
  | Round to round | 8 to 10 |

## Lockups

- **Horizontal:**
  - The mark is 1.9 × the cap height.
  - The wordmark's cap height is centred on the mark's height, then lowered 0.06 × the cap height.
  - The gap is 0.45 × the mark's width.
- **Stacked:**
  - The mark is centred over the wordmark.
  - The gap is 0.55 × the cap height.

## Clear space and minimum size

- **Clear space:** the keyframe's width on every side. That's 56 units at symbol scale.
- **Symbol:** 16 px minimum. Use the small cut at 24 px and below.
- **Horizontal lockup:** 120 px wide minimum. Below that, use the symbol alone.

## Colour

| Name | HEX | RGB | CMYK (approx.) | Use |
|---|---|---|---|---|
| Ink | `#151619` | 21 22 25 | 16 12 0 90 | Symbol, name, type, the app-icon tile |
| Paper | `#F6F6F4` | 246 246 244 | 0 0 1 4 | Default light ground |
| White | `#FFFFFF` | 255 255 255 | 0 0 0 0 | Reversed artwork, light ground |
| Signal | `#F2C440` | 242 196 64 | 0 19 74 5 | The keyframe and the i's keyframe, on Ink or dark grounds only |
| Grey | `#74767D` | 116 118 125 | 7 6 0 51 | Secondary text and rules, never the logo |

WCAG contrast:

| Pair | Ratio | Use |
|---|---|---|
| Ink on Paper | 16.72 : 1 | Any text |
| Ink on White | 18.09 : 1 | Any text |
| Signal on Ink | 10.98 : 1 | Any text |
| Grey on White | 4.54 : 1 | Body text |
| Grey on Paper | 4.19 : 1 | Large text only |
| Grey on Ink | 3.99 : 1 | Large text only |
| Signal on White | 1.65 : 1 | Never |
| Signal on Paper | 1.52 : 1 | Never |

CMYK values come from a naive conversion. Proof them in print before use.

## Motion

- **The move:** the keyframe swings out of the counter and settles back into place, once.
- **First and last frames:** the keyframe is in place at both, so a still capture always shows the mark.
- **Reduced motion:** it holds still.
- **Rules:** the D never moves, and the keyframe always ends exactly on its centre.
- **Files:** `readme-light.svg`, `readme-dark.svg` and `symbol-animated-color-dark.svg` carry the move as CSS. Every other file is still.

## Approved backgrounds

| Artwork | Use on |
|---|---|
| Ink (`*-ink.svg`) | Paper, White, light neutrals, and light, calm photo areas |
| Reversed (`*-white.svg`) | Ink, Grey or darker, and dark photo areas |
| Colour (`*-color-dark.svg`: white D, Signal keyframe) | Ink and other dark grounds only |

## Don't

- **Don't put the app's status colours on the keyframe:** green pass, pink needs you, orange sent back, purple running, cyan added. Those belong to the interface, and Signal yellow is never a status.
- **Don't take the keyframe out of the D.** The D alone is just a letter.
- **Don't turn the keyframe into a play button,** a circle or a star.
- **Don't tilt, stretch or squash the mark.**
- **Don't use Signal on White or Paper.**
- **Don't set or redraw the name in a font.** Use the wordmark files.

## Which file where

| Need | File |
|---|---|
| Symbol | `symbol-ink.svg`, `symbol-white.svg`, `symbol-color-dark.svg` |
| Symbol, 24 px and below | `symbol-small-ink.svg`, `symbol-small-white.svg`, `symbol-small-color-dark.svg` |
| Symbol in motion | `symbol-animated-color-dark.svg` |
| Wordmark | `wordmark-ink.svg`, `wordmark-white.svg`, `wordmark-color-dark.svg` |
| Lockups | `lockup-horizontal-*.svg`, `lockup-stacked-*.svg` |
| README header | `readme-light.svg`, `readme-dark.svg` (in a `<picture>` with `prefers-color-scheme`) |
| macOS app | `DeepBuild.icns`, built from `DeepBuild.iconset/` (master `app-icon.svg`; `app-icon-small.svg` for 16 and 32 px) |
| Menu bar | `menubar-template.svg`, `png/trayTemplate.png`, `png/trayTemplate@2x.png` (black on transparent; macOS tints it) |
| Web | `favicon.svg`, `png/favicon.ico` (16, 32, 48), `png/apple-touch-icon.png`, `png/icon-192.png`, `png/icon-512.png` |
| Terminal | `png/favicon-32.png`: the small cut on its Ink tile, shown at 16 pt by `deep --help` where the terminal shows images |
| Social preview | `social-preview.svg`, `png/social-preview.png` (1280 × 640, the colour lockup on Ink; upload it by hand in the repository's settings) |
| Colours | `palette.json` |
| Presentation | `board.html`, `board.png` |
| Where each file is used | `surfaces.json`: every surface of the app, CLI, README, docs and site with its kit file, checked by hash in `tests/acceptance/79` |

`build.py` writes every SVG. `render_png.py` renders the PNGs through headless Chrome, then builds the `.icns` with `iconutil` and the `.ico`.

## Trademark

`trademark-search.json` records the search done before the mark went outside the repo: the registers, terms, classes, hits and the conclusion. It is a word-mark screening, not a professional clearance; get one, covering the device too, before launch.
