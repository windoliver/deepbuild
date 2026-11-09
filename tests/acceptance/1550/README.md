# Acceptance tests for #1550: chrome wraps by the Unicode line break rules

Written first, blind, from issue #1550 (its body, five acceptance criteria, Proof, Not in scope, Depends on), `AGENTS.md`,
`docs/technical-design.md` (Dogfooding; Decided; "Built to be hard to get wrong"; the paragraph on carried vendor patches
under How it installs) and the base commit `dd83ac2f` (origin/main), by a job that never saw an implementation; none
existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding).

## What was read

- `vendor/gpui-pre/src/text_system/line_wrapper.rs` (`wrap_line`, `is_word_char`, its tests);
  `vendor/gpui-pre/src/text_system/line_layout.rs` (`compute_wrap_boundaries`, which repeats `wrap_line`'s rule over
  shaped glyphs and calls `LineWrapper::is_word_char`); `vendor/gpui-pre/src/text_system.rs` (`TextSystem::line_wrapper`,
  `TextSystem::layout_width`, `WindowTextSystem::shape_text` and `layout_line`); `vendor/gpui-pre/src/elements/text.rs`
  (a text element wraps by `window.text_system().shape_text(.., wrap_width, ..)`).
- `crates/deep-app/src/card.rs` (a card's rows are `div().text_xs().child(label)`, so its words wrap through a text
  element) and gpui-kit's theme default font, `.SystemUIFont` at 16 px, so `text_xs` is 12 px.
- `crates/deep-text/src/unicode.rs` (`LineSegmenter::new_neo_for_non_complex_scripts`), `vendor/unicode-17.0.0/README.md`
  and `LineBreakTest.txt`.
- `vendor/gpui-pre-apple/upstream/README.md` (the carried-patch table and its rules), `scripts/vendor-rebase.mjs` (how a
  row's test is listed: `vitest list` for a `.test.ts`, `node --test` for a `.test.mjs`, `cargo test -- --list` from the
  nearest `Cargo.toml` for a `.rs`), `scripts/lanes.mjs`, `scripts/proof-change.mjs` (`criterionId`).
- The replica: `crates/deep-replica` (`Cargo.toml`, `src/lib.rs`, `src/drive/mod.rs` launch options, `src/drive/locate.rs`),
  `crates/deep-app/src/views.rs` (a Needs you row is a button named by its question; a click presents its card);
  #124's suite (`tests/acceptance/124/`: README "The taste call", `helpers.ts`, `ac8-shown.test.ts`, `TASTE.json`).
- For form: `tests/acceptance/1427/README.md`, `1406/README.md`, `1312/README.md`, `390/README.md`.
- Not seen: any branch, worktree, pull request or other implementation of this issue.

## Run them

```sh
npm ci                                                     # once
npx tsc -p tests/acceptance/1550/tsconfig.json
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  npx vitest run --root tests/acceptance/1550 --no-file-parallelism --testTimeout=600000
```

`wrap.test.ts` builds the probe once (`cargo build --locked -p deep-replica --features env-plants --example
acceptance_1550_probe`, found at `target/debug/examples/acceptance_1550_probe`, or under `$CARGO_TARGET_DIR`); every test
in it fails `BLOCKED` with cargo's words when the build fails. Every probe run is a `spawnSync` that ends before the
call returns. `shown.test.ts` builds `deep-drive` with #124's helper and starts two replicas, stopped by PID. On this
machine, loaded, the two builds took about 8 minutes from an empty target; then `wrap.test.ts` runs in about 16 s and
`shown.test.ts` in about 12 s.

## The surface, and why

The issue names the wrapper (`is_word_char` in `line_wrapper.rs`) and "a question card". At the base chrome text wraps by
two public routes, and both read `is_word_char`:

- **`wrap_line`**: `TextSystem::line_wrapper(font, size)` → `LineWrapper::wrap_line(&[LineFragment::text(text)], width,
  IndentAdjustment::NoIndent)`, whose `Boundary.ix` is the byte where each later line starts. gpui-kit's editor and inline
  flow wrap by it.
- **`shape_text`**: `WindowTextSystem::shape_text(text, size, runs, Some(width), None)`, the call a text element makes for
  a card's line; its `WrappedLine::wrap_boundaries()` name the glyph each later line starts at, read back as that glyph's
  byte `index`, as gpui itself reads them (`closest_index_for_position`). It wraps by `LineLayout::compute_wrap_boundaries`,
  a copy of `wrap_line`'s rule over shaped glyphs.

A fix in `wrap_line` alone would leave the card's words breaking, so every criterion judges both routes, each named in its
failure. The smallest real surface for both is a probe over GPUI's own text system and nothing else: `probe.rs`, an
example target of `crates/deep-replica` (the crate whose replica criterion 5 needs, so the two builds share their
dependencies). It runs `gpui_kit::platform::current_platform(true).text_system()` (CoreText on macOS) in a `TextSystem`,
at the card's font, `.SystemUIFont` at 12 px, and answers JSON lines:

- `{"call":"wrap","route":"wrap_line"|"shape_text","text":s,"widths":[px...]}` → `{"ok":true,"starts":[[k...]...]}`: for
  each width, the code point offsets where a line after the first starts (a byte inside a code point reads −1).
- `{"call":"measure","texts":[s...]}` → `{"ok":true,"measures":[{"advances":[px...],"shaped":px}...]}`: each code point's
  advance as the wrapper reads it (`TextSystem::layout_width`) and the text shaped as one line (`WindowTextSystem::layout_line`).

It judges nothing. The tests (`wrap.test.ts`, with `helpers.ts`) hold the fixtures, the oracle and the judges. A Rust
`[[test]]` wasn't chosen because the carried-patch table needs the row's test listable: `vendor-rebase.mjs` lists a `.rs`
test with `cargo test -- --list` from the nearest `Cargo.toml` up from the file, which for `tests/acceptance/1550/` is the
workspace root, every test target of every crate. A `.test.ts` is listed by `vitest list`. Nothing in `vendor/` is touched
or needed by any test or plant.

Criterion 5 goes through the replica's own driver, `deep-drive` (#124): a launch on a fixture record at a narrow window,
a click on the ask's Needs you row, which presents its card, a wait for the card's first option, and a `screenshot` of the
window.

## The criteria, and what fails each

Each test's name starts with its criterion's ID, `#1550.<first 8 hex digits of SHA-256 of its "- [ ]" text>`.

| Criterion | Test (in `vitest list`) | Read as | A wrong program it fails |
|---|---|---|---|
| C1 `#1550.1699487d` | `wrap.test.ts` › `#1550.1699487d (C1) Greek, Arabic, Hebrew and Devanagari sentences wrapped at every width from the longest word up never break inside a word` | Each sentence of `fixtures/texts.json` `words`, at every integer width from the ceiling of its longest word to the ceiling of the whole sentence, both routes. A word is a run of non-white-space; a line start between two of its code points fails, shown as `κόσ|με`. | The base (both routes); any wrapper that lets a character off a word list start a line |
| C2 `#1550.575d9695` | `wrap.test.ts` › `#1550.575d9695 (C2) over a Chinese and a Japanese fixture at every width no line starts with CL, CP, EX, IS or NS and none ends with OP, unless one unbreakable cluster passes the width` | `cjk` in `texts.json`, every integer width from 1 px to the whole text, both routes. A line start at `k` fails when `k`'s class is CL, CP, EX, IS or NS, or `k − 1`'s is OP, unless the cluster around `k` (between the nearest places a line may start by that same rule) is wider than the width. | The base: `，我们` (and `。`, `？`, `」`, `）`, `・`, `々`, a line ending `「`) |
| C3 `#1550.8fc59257` | `wrap.test.ts` › `#1550.8fc59257 (C3) every boundary chrome picks over LineBreakTest.txt at narrow widths is a break the file allows` | Every case of `vendor/unicode-17.0.0/LineBreakTest.txt` except those holding a mandatory break (BK, CR, LF, NL), at its narrow widths, both routes: every line start must be a `÷` of the case. A failure names `LineBreakTest.txt:<line>`. | The base; the planted allow-list path below |
| C3, plant | `wrap.test.ts` › `#1550.8fc59257 (C3) wrong program: a planted allow-list path fails, naming the line` | The base's rule (any character off gpui-pre's allow-list, or a listed one after a space, may start a line) as a greedy twin over the probe's advances, through the same judge: it must fail, and each failure checked names a line of the file holding the case it judged. | A judge that passes everything, or names no line |
| C4 `#1550.996d9be7` | `wrap.test.ts` › `#1550.996d9be7 (C4) a 200-character path wraps inside a 300 px box` | `path` in `texts.json` (200 code points, no spaces, wider than 600 px) wrapped at 300 px by both routes; each line, shaped alone, at most 300.5 px wide. | The planted spaces-only wrap below; a wrapper that drops `/` as a break |
| C4, plant | `wrap.test.ts` › `#1550.996d9be7 (C4) wrong program: a planted wrap that breaks only at spaces fails, naming the overflow` | A greedy twin whose lines start only after white space, through the same judge: it must fail with `line 1 of 1 is N px wide, M px past the 300 px box: "/srv/…"`. | A judge that passes an overflowing line |
| C5 `#1550.54f5f264` | `shown.test.ts` › `#1550.54f5f264 (C5) the check run takes a question card in Arabic and one in Chinese at a narrow width, and reads INCONCLUSIVE unless a recorded taste call on exactly these pictures says they look right` | Two pictures from the replica (below), their form only (PNG, the narrow window at scale 2), then `TASTE.json`. | A run with no recorded call, or a call on other pictures (INCONCLUSIVE); `looks_wrong` (FAIL) |

C4 holds at the base: the base's rule lets `/` start a line, so the path wraps. It guards the fix, which must keep paths
wrapping (under UAX #14 a line may start after `/`, SY, and `-`, HY), and its plant shows the judge sees an overflow.

## How each criterion is read (choices the issue leaves open)

1. **Widths.** Integer px. C1: "from the longest word up" is from the ceiling of the widest word, measured as the wider of
   its advances' sum and its shaped width, so neither route has to break a word that fits by its own measure; up to the
   width where the sentence fits on one line. C2: "every width" is every px from 1. C3: "narrow widths" are, per case,
   from 1 px past its widest unbreakable cluster (the text between two `÷`, its trailing spaces in it, measured the same
   way) up to the whole case, at most 25 widths. Below the widest cluster even a correct wrapper must break where the file
   says `×` (or overflow), so those widths aren't judged; this is what C2's "unless one unbreakable cluster passes the
   width" says too. The 1 px margin is for a cluster measured alone against measured in its line.
2. **"Inside a word"** (C1) is between two non-white-space code points of one space-delimited word. Punctuation the
   fixtures attach to a word (`،`, `؟`, `,`, `?`, `;`, `।`) is part of it; under UAX #14 none of them may start a line.
   A line start before or after white space is not inside a word, whatever the route does with the space.
3. **Classes** (C2) are read from `LineBreakTest.txt` itself, which names each code point's class in its comments (the
   fixture's punctuation all appear there: `，。、！？「」（）・々ー`). A fixture character the file doesn't show must be a CJK
   Unified Ideograph (all ID) or a hiragana or katakana letter (ID or CJ); anything else fails the fixture. CJ (small
   kana, `ー`) is not a class the criterion names, so it is never judged, whether a segmenter takes it as NS (strict) or
   ID (normal). The fixture holds no character of a class other than ID, CJ, OP and the five, so the criterion's own rule
   gives the same clusters as UAX #14 there.
4. **"Ends with OP"**: the code point before the line start is OP. The fixtures hold no spaces.
5. **Mandatory breaks** (C3): a wrapper is handed one line; `shape_text` splits at `\n` before wrapping and `wrap_line`
   skips it. So the 2,151 cases holding BK, CR, LF or NL are left out, and the other 17,187, Thai (SA) included, are
   judged as the file says: SA resolves to AL or CM there, which the non-complex segmenter the issue names does too.
6. **A boundary** is where a later line starts, as a code point offset. Order isn't judged: at the base `shape_text`
   gives Hebrew's starts in visual order (`[11, 5]` for `שלום עולם שלום עולם` at 40 px); each start is judged where it
   falls.
7. **The box** (C4) is 300 px wide and a line is in it when its shaped width is at most 300.5 px: the line is measured
   shaped alone, while a wrapper may measure by summed advances or in its line.
8. **The font** is the card's (`.SystemUIFont`, 12 px). Off macOS the probe runs that platform's text system and the
   tests still judge it, by its own advances.
9. **The planted programs** are twins in `helpers.ts`, fed through the same judges, so nothing is added to `vendor/` or
   any crate for them. The allow-list twin ports gpui-pre's `is_word_char` list, with its Apache-2.0 notice.
10. **"Narrow width"** (C5) is a 560 × 760 point window at scale 2, against the reference 1512 × 982: the card keeps its
    480 points, so its words wrap. The fixture asks (`fixtures/card-arabic.events.jsonl`, `card-chinese.events.jsonl`) are
    choice asks with long questions and translated options.

## What the base shows (`BASE-FAILURE.txt`)

- C1, C2 and C3 fail for the issue's reasons on both routes: `κόσμ|ε,` at 91 px (the issue's `κόσ|με` was at fixed
  10 px advances), `بال|عالم،`, `עו|לם,`, `द|ुनिया,`; `今天的天气非常好|，我们…`; 8,466 line starts over 895 lines of the file.
- C3's and C4's planted programs fail their judges with the messages the criteria name; C4 itself holds at the base.
- C5 is INCONCLUSIVE: no call is recorded. Its pictures show something the other criteria can't: at the base the card's
  question doesn't wrap at all. Its row is a flex row (`div().flex().items_center().text_xs().child(label)`), so the
  text element gets no wrap width and the question runs on one line past the card's right edge, in both pictures. A fix
  of the wrapper alone leaves those pictures as they are; whether they then look right is the taste call's to say.
- At the base `shape_text` walks an RTL run's glyphs in visual order, so some of its line starts come out of order or at
  offset 0 (`LineBreakTest.txt:132`, `× 2757 × 0020 ÷ 05BE ÷`). The tests read a start as the logical offset where a
  line begins, as gpui reads a boundary elsewhere, and judge each where it falls.

## The taste call

`shown.test.ts` writes `card-arabic.png` and `card-chinese.png` to `$DD1550_SHOTS`, or `target/acceptance/1550/`, and
prints their SHA-256s. Attaching them to the PR and showing them to you in the session is the implementing agent's; no
test sees it. Your answer goes in `tests/acceptance/1550/TASTE.json`, the one file added to this folder after this draft,
in #124's form:

```json
{"issue": 1550, "criterion": "#1550.54f5f264", "verdict": "looks_right" | "looks_wrong", "who": string, "when": "ISO 8601 time",
 "files": {"card-arabic.png": sha256, "card-chinese.png": sha256}, "note"?: string}
```

No `TASTE.json` is INCONCLUSIVE. A call with no name or time, on another criterion, or whose `files` aren't this run's
SHA-256s is INCONCLUSIVE. `looks_wrong` fails; `looks_right` on exactly this run's files passes. The replica's virtual
clock makes the pictures repeat, so a call stands until they change.

## What the implementer adds (outside this folder; this job edited nothing there)

- `crates/deep-replica/Cargo.toml`, the probe (no new dependency, so `Cargo.lock` doesn't change):

  ```toml
  # Issue #1550: the probe its acceptance tests run chrome's wrapper through (tests/acceptance/1550/README.md).
  [[example]]
  name = "acceptance_1550_probe"
  path = "../../tests/acceptance/1550/probe.rs"
  ```

- `scripts/lanes.mjs`: `alone.push('tests/acceptance/1550/');` beside #1427's line (the files build cargo targets and
  start replicas).
- The row in `vendor/gpui-pre-apple/upstream/README.md`'s table, if the fix is carried: its test is
  `tests/acceptance/1550/wrap.test.ts › #1550.8fc59257 (C3) every boundary chrome picks over LineBreakTest.txt at narrow widths is a break the file allows`
  (or C1's name above), as `vitest list` names it: the tests are top-level, with no `describe`, and their titles are
  plain strings, since `vitest list` doesn't evaluate a template literal.
- No plant hook, no fixture record outside this folder, and no `.gitignore` line (`target/` is ignored).
