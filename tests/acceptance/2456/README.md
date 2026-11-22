# Acceptance tests for #2456: a text's channel-driven reveal draws as fully revealed in frames

Written first, blind, from issue #2456 (its text, its reproduction and its 2 acceptance criteria), the design sections
it leans on and base commit `b4c099e2e` ("Merge pull request #2861 …"), by a job that never saw an implementation;
none existed, and no other worktree, branch, PR, stash or session was read. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test per
criterion, plus one planted wrong program per criterion, which shows its judge can fail.

## What was read

- Issue #2456, live, no comments; issue #222's text for the surfaces it names (the 40-cue explainer, "frames … taken
  by the check run from the canvas's own frames").
- `docs/canvas-primitives.md`: Text `text@1` (`reveal: {mode: fade | write, order: reading | seeded, progress: channel
  0..1, emits}`; units are graphemes; `lag = min(4 ÷ n, 0.2)`; "the progress runs linear unless keyed otherwise");
  Placement (a stagger: "target i at i × lag × d, for a total of d × ((n − 1) × lag + 1)"); Channel and key (`keys`,
  `interp: linear`, `extrapolate = hold`); Paint (fill and stroke) ("writer layers composite in sRGB-encoded space");
  Cue list `cues@1` (the verbs that key `params/reveal/progress`); Time and the flick.
- `docs/technical-design.md`: Films and figures on the canvas; The canvas core's Conventions ("2D writer layers
  composite in sRGB-encoded space"); Dogfooding.
- At the base, for call shapes only: `crates/deep-show` (`deep-show run`; `deep show` with `include`; `eval {doc, t,
  paths, pixels}` in `main.rs` and its reply in `frames.rs`; the evidence store's layout), `docs/evidence/222/shoot.mjs`
  (#222's explainer, shot through `eval` with `pixels`, whose texts fade "rather than write: the frames don't yet draw a
  text's channel-driven reveal"), `packs/verbs-1.0.0/` (`write` and `by_letter` key `params/reveal/progress` from 0),
  `crates/deep-canvas-marks/src/animator.rs` and `modules.rs` (where a reveal's units and shares live),
  `crates/deep-marks-raster/src/lib.rs` (the film block's glyph report); the merged suites `222/`, `1969/`, `1646/`,
  `466/` (`ac5-reveal`), `493/` (helpers); `scripts/proof-change.mjs` (criterion IDs), `scripts/lanes.mjs`,
  `scripts/known-failures.json`. Code was read to learn the surface; every expected value comes from the issue and
  the design.

## Run them

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node scripts/throttle.mjs test -- npx vitest run --root tests/acceptance/2456 --no-file-parallelism --testTimeout=3600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2456/tsconfig.json   # type-check (exits 0)
rm -rf tests/acceptance/2456/node_modules/.vite
```

Each file builds `deep-show` once, in `beforeAll` (`cargo build --locked --bin deep-show --no-default-features
--features full`, with `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0` unless set, honoring `CARGO_TARGET_DIR`; rustup's
`cargo` added to PATH when PATH has none), copies the binary out, and fails every test whose build failed, with cargo's
error. The files build a cargo binary, so they run one at a time: the implementer adds to `scripts/lanes.mjs` (this
job writes only this folder):

```js
alone.push('tests/acceptance/2456/');
```

Every `it` passes a 60-minute timeout. Temporary folders (the binary's copy, each evidence store) are deleted. Node
built-ins and vitest only. Nothing is timed. A test that can't decide here fails with a message starting
`INCONCLUSIVE:`, never passing.

## The surface under test

`deep-show run` as #393, #222 and #1969 left it, with no new call, field or binary: one scenario line in (your shell's
process tree, one panel, each document on it), one answer line out. Calls:

- `deep show` of a whole film from your shell with `include: ["issues"]`: `outcome: "presented"`, no issue of severity
  `error`.
- `eval {doc, t, paths?, pixels: true}` (#387; #1918's `values`): `values["items/tx/params/reveal/progress"]`, and
  `snapshots[0].sha256`, the frame the canvas drew at t, a PNG in the scenario's evidence store at
  `<evidence>/<sha[0..2]>/<sha[2..]>`, which must hash to its name. This is the issue's own reproduction ("`eval` at
  0.5 s and 1.5 s reads `progress` 0 and 0.5; the pixels at both times show the whole text") and the call #222's
  explainer was shot through "from the canvas's own frames".

Films are sent as your shell sends them (#222's form: `profile: "film"`, 640 × 360 u, `transport.span`, no `id`, no
`layers`); a channel is `{target, type: "f32", keys: {k0: {t, value, interp: "linear"}, …}}` in the film's `channels`
(#466's and #1969's form). The item ID `tx` and the path `items/tx/params/reveal/progress` are the issue's; the
channel's ID `reveal` and the films' titles are *(chosen)*.

## Fixtures

None stored: `helpers.ts` writes every film. Each is 640 × 360 u over 3 s and holds one text item `tx`, the issue's
"Hello there" (11 graphemes, the space one of them) in the body role at 64 u, ink fill, at (40, 140) *(size, role and
place chosen; the issue gives only the text)*.

| Film | `tx`'s reveal | Channel |
|---|---|---|
| `keyed` (the issue's) | `{mode: fade, order: reading, progress: 1}` | on `items/tx/params/reveal/progress`: 0 at 1 s, 1 at 2 s, linear |
| `written` | `{mode: fade, order: reading, progress: 1}` | none |
| `zero`, `half`, `whole` | `{mode: fade, order: reading, progress}` at 0, 0.5 and 1 | none |
| `plain` | none | none |

Every film is drawn at 0.5 s, 1.5 s and 2.5 s.

## Criteria to tests

IDs are `#2456.` and the first 8 hex digits of SHA-256 of each criterion's text, trimmed, white space collapsed
(`scripts/proof-change.mjs`), from the live issue. Each test's name starts with `AC<n> <ID>`; each file's header
quotes its criterion and states its documents, numbers and wrong programs.

| Criterion | File (tests) | What it asserts |
|---|---|---|
| AC1 `#2456.6a4fab33` | `keyed.test.ts` (2) | `eval` reads the progress 0, 0.5 and 1 at 0.5 s, 1.5 s and 2.5 s (else INCONCLUSIVE). In the keyed film's frames there: at 0.5 s no grapheme draws (every pixel within 2 code values of the ground); at 1.5 s "H", "e" and "l" draw all of the plain text's ink, "l" 0.9 of it, "o" 0.7, "t" 0.3 and "h" 0.1 (within 0.05, and their solid pixels at that share within 0.1), and "e", "r", "e" none; at 2.5 s every grapheme all of it. Planted: the written film's frames (the reveal drawn as written, whole at every time) fail that judge at progress 0 and 0.5 and pass it at 1 |
| AC2 `#2456.3ee39994` | `unkeyed.test.ts` (2) | At each of the three times, `zero` draws none of its graphemes, `half` each by its share at 0.5 (the shares above) and `whole` all, read as AC1 reads; `plain` draws the same frame at the three times (every pixel within 2 code values). Planted: `zero`'s frames read as `whole`'s and `whole`'s as `half`'s fail at every time |

## Readings where the issue leaves a choice

1. **"The canvas's own frames"** are the frames `deep-show run`'s `eval` with `pixels` draws, the issue's own
   reproduction and #222's shoot. Other frame paths (the `deep show` reply's snapshot, an export's frames, the
   `frames` call) aren't read.
2. **Which times are progress 0, 0.5 and 1**: the issue's channel (0 at 1 s, 1 at 2 s) read at 0.5 s and 1.5 s, the
   times the issue reads 0 and 0.5 at, and at 2.5 s, where it says the whole text shows; a channel holds its first and
   last keys outside them (Channel and key: `extrapolate = hold`). Keys are linear *(chosen; the issue names no
   interp, and the design's progress "runs linear unless keyed otherwise")*. Each frame's `eval` also reads the
   progress, which must be 0, 0.5 and 1 within 1e-9, or the test is INCONCLUSIVE: the criterion can't be judged at a
   progress the frame isn't at.
3. **Units and shares** are the design's: UAX #29 graphemes of "Hello there" (11, the space one of them), lag = min(4 ÷
   11, 0.2) = 0.2, each grapheme revealing over w = 1 ÷ (1 + 10 × 0.2) = 1/3 of the progress from u × lag × w = u/15,
   so its share at p is clamp((p − u/15) × 3, 0, 1): at 0 all 0; at 0.5 1, 1, 1, 0.9, 0.7, 0.5, 0.3, 0.1, 0, 0, 0; at 1
   all 1. Reading order is left to right.
4. **Telling graphemes apart in a frame**: the plain film's frame at the same time (the same text, no reveal, the same
   place) is cut into stripes. Its ground is its most frequent color; a pixel more than 2 code values off it has ink;
   its columns with ink form one run per grapheme that draws (10: the space draws nothing), read left to right; each
   stripe runs to the middle of the gaps on either side, the first from the frame's left edge and the last to its
   right. A frame whose runs don't number 10, or whose ink spans more than one line, makes the test INCONCLUSIVE. The
   space, which draws nothing at any share, has no stripe and no share to read.
5. **"Draws none"** of a grapheme: every pixel of its stripe within 2 code values of the ground.
6. **"By its share"** (share above 0): a fade draws a grapheme at opacity equal to its share, and 2D writer layers
   composite in sRGB-encoded space (design: Paint, Conventions), so each of its pixels moves its share of the way from
   the ground to the plain text's pixel, in 8-bit codes. Read two ways: its ink (the sum over its stripe's pixels and
   channels of the distance from the ground) is its share of the plain text's within 0.05; and at least 99% of its
   solid pixels (where the plain text's ink is at least 90% of its strongest) carry its share of the plain text's ink
   within 0.1, so it's drawn whole at its share, never part drawn and part not. A grapheme whose share is 0.1 off (units
   that skip the space, a lag of 4 ÷ n uncapped) fails the first; a wipe fails the second.
7. **"All at 1"** is every grapheme by share 1, read as in 6: all of the plain text's ink, drawn as it draws it.
8. **"As it does today"** (AC2): today the text layout reads a reveal "from the item as written" (the issue), so a text
   whose reveal no channel keys draws at the progress its document writes, at every time, by the design's schedule,
   and a text with no reveal draws whole and doesn't change. Held with the same reading as AC1, at AC1's times, for
   written progress 0, 0.5 and 1. It isn't compared with pictures stored from the base: those would also hold every
   unrelated change to how text draws.
9. **The planted wrong programs** are frames the canvas draws for other documents, which show what the wrong program
   shows: the written film is what a frame that draws the issue's reveal as written draws at every time (AC1); `zero`
   is what a reveal no channel keys draws if read as progress 0, and `whole` what it draws if dropped (AC2). Each must
   fail its judge, so neither judge passes everything; AC1's must also pass the written film at progress 1.

## Not tested here

- Write mode (the outline drawn over the first half of each unit's span, then its fill): the issue's reproduction and
  criteria hold a fade; #1969 holds write mode's drawing through `deep-canvas-render raster`.
- The verbs (`write`, `by_letter`, `by_word`, `unwrite`) played through a cue list: they key this same path, and the
  criterion's "a channel keys" is held by a channel written by hand, as the issue's reproduction writes it.
- A film with a camera item, shots or a look of its own, as #222's explainer was written: the issue's reproduction
  names none, so these films hold only the text.
- Frames by other paths (`deep show`'s own snapshot, export, `frames`), seeking against playing, `order: seeded`,
  `emits`, `#head`, the film block's glyph opacities, reduced motion, several lines and right-to-left text.

## At the base

Run once at `b4c099e2e` (`BASE-RUN.txt`, with the output): all four tests pass. AC1 passes: the issue's reproduction,
as these tests write it (a film with no camera item, the channel written by hand, frames from `eval` with `pixels`),
already draws none of its graphemes at 0.5 s, its shares at 1.5 s (read as 1, 1, 1, 0.903, 0.702, 0.298, 0.098, 0, 0,
0 against the design's 1, 1, 1, 0.9, 0.7, 0.3, 0.1, 0, 0, 0) and all at 2.5 s. AC2 passes, and each planted wrong
program fails its judge. The type-check exits 0.
