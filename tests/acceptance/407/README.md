# Acceptance tests for #407: the film audit: readable text, reading holds, flicker, captions and a brief's checks

Written first, blind, from issue #407 ("The film audit: readable text, reading holds, flicker, captions and a brief's
checks": its scope, its Film audit and Flicker check fields, its 14 acceptance criteria and its proof line, "Each film
check's parity fixture and planted twin failing with its code and frame"), its Oracle page, the design rows, and the
base commit `04f44a4ba` ("Merge pull request #2230 …") by a job that never saw an implementation; none exists at the
base, and no other worktree, branch or PR was read. The implementing agent doesn't edit these files (AGENTS.md, Proof);
a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test per criterion, plus the planted
programs the criteria name (9, 10 and 14) and the control criterion 9 needs. The Oracle lane for criterion 3 is in
`tests/acceptance/407-oracle/`.

**Not run against a binary.** The machine's one-minute load was about 210 on 18 cores, with 16 builds queued in the
throttle table, so `deep-show` was not built and the suite was not run at the base. `BASE-FAILURE.txt` says what each
test meets first there, read from the base's code, and what was run: the type-check, a scratch run of the fixture
generators, and cargo refusing the feature `test-hold-min-2s`.

## What was read

- Issue #407 (body only, as of Nov 10, 2026) and its Oracle page (`doneright/oracles/issues/407.md`, branch
  `doneright` of DeepBuildAI/deepbuild), which links an upstream flash-detection suite to criterion 3 and none to the
  other 13. Test names start `AC<n> #407.<id>`, the first 8 hex digits of SHA-256 of the checkbox text after `- [ ] `,
  trimmed, white space collapsed (`scripts/proof-change.mjs`, `criterionId`).
- `docs/technical-design.md` at the base: Document check (1566: the film audit's line, "It can never: Pass a claim on
  its own unless the document is the work; keep a revision from showing for an issue its last good revision already
  had, which a verdict still counts"); What done means, fixed at the start (2125), with Who drafts it and Proven on the
  base; Dogfooding's Criteria to tests, Wrong programs and the edit guard (2626-2632).
- `docs/canvas-primitives.md` at the base: What holds a document to its rules and Check input (8314: issues as data
  `{check, code, severity, ids, path, actual, t, what, fix}`; `film.audit`, `film.flicker` and `honest_numbers` among
  the core's kinds); Film audit (8908), Film audit: craft@1, Film layout (8953), Film brief (8978), Flicker check (8999),
  Honest numbers (9017); Narration and captions (8211) and Loudness and caption profiles (8251); Look `look@1`: captions
  (2792) and print finishes (2758: "Flicker is a gain on linear luminance, so ±5% of Y peaks at 0.1 and passes the
  flicker check"); Transport (5173: the reduced-motion rendition) and Transport: film viewer; Marker and Marker: present
  mode (5304); Pack: piece@1 (3534); Shot (4541), Transition (5856), Cue list (6030); Text `text@1` (1408: `copy`,
  `max_lines`, `reveal`); Text animator (5931); Paint (1683); Image (1803); Document envelope (292: `brief`, `look`,
  `assets`).
- At the base, for surfaces and conventions only: AGENTS.md, CONTRIBUTING.md; `crates/deep-show` (`src/main.rs`: the
  scenario, `claims`, the planted match and `bad_input`; `src/hub.rs`: `Planted`, `Claim`, `Requirement`;
  `src/verdict.rs`: the `verdict` call, where `film.audit` and `film.flicker` are BLOCKED `not_run`; `src/film_layout.rs`,
  `src/film.rs`, `src/narration.rs`, `src/shared.rs`'s stored documents; `Cargo.toml`'s `test-*` features);
  `crates/deep-canvas` (`CORE_CHECK_KINDS`, the envelope's keys, `Issue::to_json`, the honest-numbers rules);
  `crates/deep-canvas-marks` (the text animator's reduced-motion rule, `reveal`, `print_wear`);
  `crates/deep-canvas-media/src/captions.rs` (netflix-en-adult, the only shipped caption profile); the bundled fonts
  (`crates/deep-text/fonts`: no Thai face). Suites read for their harness: `tests/acceptance/408/`, `403/`, `371/`,
  `502/` and `502-oracle/`, `405/`, `1637/`, `493/`, `1646/`, `1162/`, `464/`. Every expected value comes from the
  issue and the design.

## What the base has

`deep-show run` with #403's `claims`, requirements and `verdict`; #371's show-time admission with `carried` issues;
#408's `film.layout`; #493's shots, cuts and reduced-motion dissolve; #502's script, caption lines and netflix-en-adult;
#1646's `reveal`; honest numbers with `number_unsourced` (no `t`). `film.audit` and `film.flicker` are core kinds the
verdict answers BLOCKED `{code: not_run}`. There is no brief, no `sources` or `cites`, no CJK caption profile, no
`test-hold-min-2s`, and none of the four planted names.

## Run them

They build `deep-show` with cargo, so they run one file at a time. The implementer adds this to `scripts/lanes.mjs` (this
README is the instruction; this job edits nothing outside its folders):

```js
// #407's files each build deep-show (carried.test.ts also with test-hold-min-2s); 407-oracle builds it too.
alone.push('tests/acceptance/407/', 'tests/acceptance/407-oracle/');
```

```sh
npm ci                                   # once, if node_modules is missing
export PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
node node_modules/vitest/vitest.mjs run --root tests/acceptance/407 --testTimeout=600000 --no-file-parallelism
node node_modules/vitest/vitest.mjs run --root tests/acceptance/407-oracle --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/407/tsconfig.json          # type-check (exits 0)
node node_modules/typescript/bin/tsc -p tests/acceptance/407-oracle/tsconfig.json   # type-check (exits 0)
rm -rf tests/acceptance/407/node_modules/.vite tests/acceptance/407-oracle/node_modules/.vite
```

Each file first runs `cargo build --locked --bin deep-show --no-default-features --features full` (and
`full,test-hold-min-2s` for `carried.test.ts`), copies the binary out of `target/` (honouring `CARGO_TARGET_DIR`) and
fails each test whose build failed. Every test writes into temporary folders and deletes them. Node built-ins and
vitest only; `407-oracle` imports `../407/helpers.ts`.

## Criteria to tests

| ID | File (tests) | What it asserts |
|---|---|---|
| AC1 `#407.1d0942b2` | `holds.test.ts` (1) | Boundary pairs 5 to 7 frames either side of each need: "THE KETTLE SINGS" 2.35 s FAILs (film.hold_short, `need` 2.43 ± 0.005, `t` 1 s), 2.55 s PASSes; "Steam lifts the lid." 2.55 / 2.75 s (2.63); "水开了，壶在唱歌。" 3.10 / 3.30 s (3.19); a title card 3.90 / 4.10 s (4); typed by a reveal from 1 to 2 s then held 2.35 s FAILs (`t` 2 s ± a frame, though 3.35 s counting the typing) and 2.55 s PASSes; a title card the frame cuts FAILs with `held` 0 |
| AC2 `#407.ce50be00` | `holds.test.ts` (1) | Thai "กาต้มน้ำร้องเพลง": BLOCKED, a `blocked` entry naming the item and `script` Thai; a caption line "The kettle sings." under netflix-en-adult (0.85 s; the rule asks 2.5 s) and "水开了。" under netflix-zh-hans PASS; control: a caption with a 46-letter word FAILs naming its caption |
| AC3 `#407.2d08dfcb` | `flicker.test.ts` (1); oracle in `407-oracle/` | A near-white sky (sRGB 245) over a third of the frame under `print_wear: {flicker: 5%}` PASSes; a mid-grey quarter swinging 0.150 (sRGB 124 and 160) at 4 Hz FAILs with film.flash at `t` 1 s |
| AC4 `#407.b38e05f8` | `film-checks.test.ts` (1) | The headline whose de copy needs four lines or more in a two-line box FAILs with film.line_limit naming the headline and `locale` de, `t` 1 s |
| AC5 `#407.6f6541a9` | `brief.test.ts` (1) | Under a brief of 2 moments, 3 holds and 2 cues: the whole render's claim PASSes with exactly one row `from` each of the 7 entries, all PASS; renders missing the cue c-pour, the moment m-steam or the text t-steam each FAIL, that entry's row FAIL and the other six PASS |
| AC6 `#407.64b30d68` | `film-checks.test.ts` (1) | film.hold_short `t` 1 s; film.boundary naming the kettle at the cut, `t` 3 s; film.cursor_crossing naming "Stir", `t` in [1.65, 1.75] s, and none naming "Pour", the text it presses |
| AC7 `#407.0ee0ea87` | `film-checks.test.ts` (1) | Six parity fixtures PASS; six twins FAIL with exactly their code and frame: film.hold_short 1 s, film.line_limit 1 s, film.boundary 3 s, film.cursor_crossing [1.65, 1.75] s, film.flash 1 s (± a frame at 24 fps, under {kind: film.flicker}), number_unsourced 2 s (under {kind: honest_numbers}) |
| AC8 `#407.4b703bba` | `reduced-motion.test.ts` (1) | A title card under a slow push: FAIL, a film.hold_short naming the title with `rendition: reduced_motion` and `t` in [1, 3.35] s, none `as_made`; the same push marked `essential` PASSes |
| AC9 `#407.0c62af86` | `carried.test.ts` (3) | Control in `full`: PASS. In `full,test-hold-min-2s`: your typo fix is applied, its reply listing film.hold_short on word-go and word-up `carried: true`; the verdict then FAILs, film.hold_short naming word-go at 1 s and word-up at 3 s. Planted `verdict_counts_new_issues` fails this, naming both |
| AC10 `#407.a3712df9` | `flicker.test.ts` (3) | The 2 Hz quarter PASSes and the 2 Hz halves in counter-phase FAIL (film.flash, `t` 1 s); planted `flicker_counts_single_changes` fails the first, naming it; planted `flicker_whole_view_mean` passes the second and fails, naming it |
| AC11 `#407.58086c02` | `cites.test.ts` (1) | Six cited caption lines PASS; line 4 uncited: film.uncited naming l4, `t` 10 s; line 2's quote one word off: film.quote_missing naming l2; line 3 at 3.2 km against 3.4 km: film.number_mismatch naming l3 |
| AC12 `#407.f621d801` | `cites.test.ts` (1) | A staged piece's sentence in stage 2: cited PASSes; uncited, quote one word off and 3.2 km against 3.4 km each FAIL with that code naming the item `fact` and `stage` stage-2 |
| AC13 `#407.4f632f03` | `cites.test.ts` (1) | Under a brief with no `sources`, the uncited script raises none of the three codes, the row lists `claims` in `not_run`, and isn't FAIL |
| AC14 `#407.56eb7041` | `cites.test.ts` (2) | `cites: []` on line 4: film.uncited naming l4 at 10 s; planted `cites_empty_passes` fails this, naming l4 |

## The surface under test

**No new binary and no new call.** #393's `deep-show run` (one scenario line in, one answer line out) with #403's
scenario `claims`, `requirements` and the `verdict` call, and #371's patches through `deep show`. What the issue names
and the base lacks is added as below. Every name marked *(chosen)* is this job's: the issue and design leave it open,
and an implementation builds exactly it or disputes it through a blind redraft.

### The check inputs (Check input)

A requirement's `check` is one of `{kind: "film.audit"}`, `{kind: "film.flicker"}` or `{kind: "honest_numbers"}`, every
field at the issue's defaults (`readable`, `hold {min 1.5, min_title_card 4, pad 1.5, rate {cjk 4.5, other 15}}`,
`max_flashes 3`, `area 0.25`, `luminance_delta 0.1`, `darker_max 0.80`). The cursor's film adds
`cursor_path: {item: "cursor", presses: ["pour"]}` *(chosen: `cursor_path`'s shape, the cursor item and the texts it
presses)*. Each film is a scenario document stored on the panel (`docs[<id>].document`, revision 0, one layer of
yours) and the one deliverable of its own claim of alpha's.

### The brief *(chosen: where it sits and its shape)*

A claim takes `brief` beside `requirements`, standing in for the locked definition's brief (the document envelope's
`brief: definition handle` names it): `{goal: string, moments?: [marker ID], holds?: [item ID], cues?: [marker ID],
sources?: [{id, title, text}]}`. A moment names a marker of kind `moment`, a cue one of kind `cue`, a hold a text item.
`sources` is the issue's field; each source's `text` is what a quote must be found in, word for word.

- **The brief's checks.** For a claim with a brief, the verdict's `requirements` hold one row per moment, hold and cue
  of the brief, each `{id, kind: "film.audit", result, issues, from}` with `from: {moment: ID}`, `{hold: ID}` or
  `{cue: ID}` *(chosen)*. A row is PASS when the render has that marker (outside any transition, and showing under
  reduced motion) or holds that text long enough, else FAIL. Criterion 5's claims have no other requirement (an empty
  `requirements`); which code a missing entry raises isn't read.
- **The claim check.** A `film.audit` requirement on a claim whose brief lists `sources` checks each narration line's
  and each on-screen sentence's `cites: [{source, quote}]` (`source` a source's `id`): on a script line,
  `script.lines.<id>.cites`; on a text@1, `params.cites` *(chosen)*, the cites of its one sentence. With no `sources`
  it runs no claim check and the row lists it in `not_run: ["claims"]` *(chosen: the field and the name `claims`)*.

### The rows

#403's row `{id, kind, result, blocked?, issues}`, decided: `FAIL` when the check raises an error, `BLOCKED` when it
can't decide (a script with no rate), else `PASS`. Its issues are in the design's shape; a code's fields sit on the
issue itself or in its `actual` (the tests read the issue first). `t` is the frame's time, integer flicks or `"<n>s"`;
`need` and `held` are seconds (a number, or `"<n>s"`).

### The codes *(chosen, except the issue's three and the base's `number_unsourced`)*

| Code | Check | Fields read | Frame `t` |
|---|---|---|---|
| `film.hold_short` | film.audit | the item (in `ids` or a field), `need` s, `held` s (0 for a hold that never starts), `rendition`: `as_made` \| `reduced_motion` *(chosen)* | the first frame of the run judged |
| `film.line_limit` | film.audit | the item, `locale`: the copy that wraps past the line limit | the first frame the headline shows |
| `film.boundary` | film.audit | the carried item that doesn't match | the cut: the incoming shot's first frame |
| `film.cursor_crossing` | film.audit | the text crossed (and the cursor) | the first frame the cursor is on it |
| `film.flash` | film.flicker | none read | the first frame of the first flash in the first one-second window holding more than three |
| `number_unsourced` (base) | honest_numbers | the item | the first frame the number shows |
| `film.uncited`, `film.quote_missing`, `film.number_mismatch` (issue) | film.audit | a line: `line` (or `ids`, or a path under `script/lines/<id>`); on-screen text: the item and `stage`, the stage marker's ID | for film.uncited on a line, the line's first frame |

A script with no stated rate is a `blocked` entry naming the item (in `ids` or a field) with `script`: the script's name
or ISO 15924 code, "Thai" either way *(chosen: `script`)*; its `code` isn't read.

### The test build

A Cargo feature **`test-hold-min-2s`** on `deep-show` *(chosen)*, joining the `full` set and never in a shipped build:
the film audit's `hold.min` is 2 s; nothing else changes. Show-time admission runs the film audit on a film, so a patch
reply lists its issues, those its last good revision already had marked `carried: true` (#371's rule).

### The planted programs (the scenario's `planted`, reachable only there) *(chosen names)*

| Name | The wrong program | Criterion |
|---|---|---|
| `verdict_counts_new_issues` | a verdict that counts only the issues the patch brought | AC9 |
| `flicker_counts_single_changes` | the flicker check counts each single change of a region as a flash | AC10 |
| `flicker_whole_view_mean` | the flicker check takes one region, the whole view, and its mean luminance | AC10 |
| `cites_empty_passes` | the claim check takes `cites: []` as cited | AC14 |

Added to `Planted` in `crates/deep-show/src/hub.rs` and named in `src/main.rs`'s planted match; at the base each makes
the scenario `bad_input`.

## Fixtures

All built at test time by `helpers.ts`, truth by construction; nothing is committed but code. Films are 1920 × 1080 u
with `safe: 24` at 60 frames a second, one layer of yours; flicker films 640 × 360 u at 24. A text is shown over
`[from, to)` by hold keys on its `adjust.opacity` (0, 1, 0), every key on a 0.05 s grid, so holds are whole frames. Text
films hold the kettle, a rect, beside the text, so no text is its shot's only subject; a title card is a text that is
its one shot's only subject (`frame.keep: [title]`, the shot's pose set to the whole page). Flicker films use looks
built here (`lookOf`: a drawing basis whose `ground`, `muted`, `accent` and `raised` roles are given sRGB grays, with
one set of roles for both themes so the base's look guard accepts it, put in the evidence store and named by
`look: {asset}` and `assets`), so every pixel's relative luminance is known: rects in
those roles, the upper one shown and hidden by hold keys. The brief's source is one paragraph of six sentences; the
script's six `caption` lines quote them, line n at 1 + 3(n − 1) s.

## Legs that read BLOCKED or INCONCLUSIVE

None. Every leg runs on this Mac through `deep-show run`: the film audit reads evaluated data and the flicker check the
CPU's frames, so no GPU, Docker or timing judgement is needed.

## Readings where the issue leaves a choice

- **Holds are whole frames,** first readable frame to the first frame not readable; each pair sits 5 to 7 frames from
  its need, so a frame either way can't decide it, while a rate that counts spaces, CJK at the Latin rate, a title card
  held to the text rule or time counted while typing each lands on the wrong side.
- **A typewriter** is text@1's `reveal` (fade, reading order) with its progress keyed 0 to 1 from 1 s to 2 s, the
  base's reveal; its hold starts at full reveal, 2 s (one frame of slack).
- **"A title cut by the frame never starts its hold"** is a film.hold_short whose `held` is 0.
- **"The script" is Thai** as the issue says, though no bundled face draws it: a `text.glyph_missing` beside it is
  allowed, and the row must still be BLOCKED (as #403's verdict ranks BLOCKED above FAIL).
- **Captions.** The caption lines are `caption` lines, with no speech job; "within its profile" is a caption the
  profile's layout and limits pass. The zh-Hans caption (4 graphemes) is within any profile whose minimum duration and
  line length the guides give; its values aren't read. The en control's 46-letter word is past 42 characters a line, so
  the audit must hold captions to their profile at all.
- **Flicker.** "A quarter" is exactly a quarter of the frame and counts, as the failing case needs; the sky covers a
  third, so it can't pass by being too small. "Four times a second" is four full swings (eight changes, four flashes);
  "2 Hz (four changes a second)" two. Counter-phase halves change at the same instants, one up, one down.
- **The frame a flash names** is the first frame of the first flash in the first failing second, 1 s in every fixture;
  the oracle accepts any frame in that second.
- **Line limit** is the text's own `max_lines` (Text: "the fit check uses … the line limit the longest copy across
  locales"), copies in `data.copy[locale]` named by `copy`; the input's `line_limit` stays at its default. "Naming the
  copy" is `locale: de`.
- **A shot boundary** is a cut between two shots on one camera, framing the same page; the kettle is carried by the
  cut's `carry` and moves 300 u at it.
- **The cursor** is an 8 u rect the input names; it crosses "Stir" on the way and presses "Pour" at the end. Its first
  crossing frame depends on glyph boxes, so the window is 1.65 to 1.75 s.
- **Honest numbers' frame** is the first frame the number shows (2 s); the parity number is a story constant through a
  template.
- **Criterion 8's title "fades in place instead of flying".** The base's reduced motion keeps a text animator's opacity
  and drops its lift (`deep-canvas-marks`, `animate`), so an animator alone can never make a hold shorter under reduced
  motion. The fixture's title flies in with the camera's slow push (under 0.3 px a frame, so readable as made); under
  reduced motion the push is a cut at its midpoint with a 200 ms dissolve, where the title fades in place and its first
  readable run ends. The `essential` twin shows the rendition, not the film, is what fails.
- **Criterion 9's control** builds `full` too, so a test build that changed nothing, or a shipped rule of 2 s, fails.
- **A staged piece** is a film with three stage markers; its sentence shows in stage 2 only.
- **"Lists it as not run, never as passed"**: `not_run` holds `claims`, no code of the claim check is raised, and the
  row isn't FAIL; whether it is PASS is the rest of the audit's.

## Not tested

Because no criterion asks: `readable`'s motion, opacity, contrast and size thresholds one by one; a brief tightening a
number; `except` and declared cuts; a counter's ticking; the `reseed` rule; craft@1; film.blank (held in #157); a
legend for status colors; a narration locale no profile covers; netflix-ja and netflix-ko; the CJK profiles' values
and dates; headings and title cards as non-claims; a bound value needing no quote; a sentence's model reading; text of
several sentences; `slow` reduced motion; present mode's waits and paths.

## Not settled

- The codes and fields marked *(chosen)*, and `need`/`held` as seconds.
- Whether a missing hold's row raises film.hold_short or another code (not read).
- Whether a film with a brief also gets a row for the audit as a whole (allowed; only rows with `from` are counted).
