# Acceptance tests for #1968: moving diffs, text_diff on code token by token, with the code film's budgets and pictures

Written first, from issue #1968 (its scope, its fields, its three acceptance criteria and its proof line), the design
sections it links and those they lean on, and base commit `a12be6c8` ("Merge pull request #2525 …"), by a job that never
saw an implementation; none existed, and no other worktree, branch, pull request or `tests/acceptance/1968*` folder was
read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding). The Oracle lane for criterion 1 (the pinned upstream diff tests, run on our code) is the sibling
folder `tests/acceptance/1968-oracle/`.

## What was read

- The issue (`gh issue view 1968`): criteria `#1968.4bf4e5fe`, `#1968.161c44a9` and `#1968.84837e9c`, their IDs
  computed as `scripts/proof-change.mjs` does.
- `docs/canvas-primitives.md`: Text `text@1` (`line_height`, `size`), Text `text@1`: code (its `text_diff` sentence:
  "aligns them line by line by a longest common subsequence, then token by token inside changed lines, comparing lines
  and tokens by their raw bytes, ties to the earlier position, so kept tokens move to their new places, an inserted line
  opens its space as the lines below slide down, a deleted line closes, and a changed token cross-fades"; the anchors
  `#line:n` and `#tok:k`), Transition (its fields and its `text_diff` sentence), Look `look@1` (code and diff roles), Cell
  grid `cells@1` ("seeking equals playing" for a recording), ID and sub-address.
- `docs/technical-design.md`: Films and figures on the canvas, Dogfooding, How we know version 0 works (budgets on a
  reference Mac, wrong programs); `docs/parallel-proof.md` §12a (budget windows).
- At the base, only for how surfaces are driven and what answers look like: `tests/acceptance/494/` (README, helpers,
  `match-morph.test.ts`: a transition between two items in one film, read from `eval`'s film block), `1965/`, `1966/`,
  `1967/` (code items, highlights, a terminal recording in a cell grid), `224/` (`ac02-rebuild-budget.test.ts`,
  `ac11-taste.test.ts`, helpers), `535/` (helpers and `ac7-taste.test.ts`: `deep-show run`'s PNGs and `frames`);
  `crates/deep-canvas-marks/src/{code,lines}.rs`, `crates/deep-canvas-motion/src/{doc,morph,shots}.rs`,
  `crates/deep-show/src/{film,frames}.rs`, `benchmarks/canvas.mjs`, `benchmarks/budgets.json`, `scripts/benchmark.mjs`.

## Run

```sh
npm ci                      # once, if node_modules is missing
PATH=$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH \
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease npx vitest run --root tests/acceptance/1968 --no-file-parallelism --testTimeout=600000
npx tsc --noEmit -p tests/acceptance/1968      # type-check (exits 0)
```

Each file builds `deep-show` once before its tests (`cargo build --locked --bin deep-show`, the default and full build
set, honoring `CARGO_TARGET_DIR`; #535's `prebuild`), and a test whose build failed fails with cargo's error. Run
**alone**: the files build a cargo binary, so `scripts/lanes.mjs` should list `'tests/acceptance/1968/'` in `alone` (this
job writes only this folder; the implementer makes that edit). A run with `--root` leaves Vitest's cache in
`tests/acceptance/1968/node_modules/.vite`; delete it. The folder imports `../535/helpers.ts` and `../224/helpers.ts` by
path. Node built-ins and vitest only; every evidence store is a temporary folder, deleted after its test. Only
`ac3-taste.test.ts` writes a file you keep, in `docs/evidence/1968/`.

`BASE-FAILURE.txt` is the run at the base: all 5 tests fail, each at its own assertion for missing behavior (below).

## The surface under test

The issue names fields and observations but no call, so these tests use `deep-show run`, the surface #494 extended for a
transition between two items, and add one answer. **Every name below that neither the issue nor the design gives is this
job's choice** (listed again under Choices); the implementer builds exactly these, or a dispute goes to a blind redraft.

- **A scenario** (#535's `scenario`): the agent's session, one panel per document; each document shown by the agent's
  `deep_show` (no `layers`, no item `layer`), then read.
- **`eval {doc, t, film: true}`** (#387's `eval`, #493's film block): the film block gains **`diffs`**, present on every
  `film: true` reply (`{}` for a film with no text diff):

  ```text
  "diffs": {<transition ID>: {"progress": 0..1,
                              "tokens": [{"from": "<from item>#tok:<k>" | null, "to": "<to item>#tok:<k>" | null,
                                          "box": [x, y, w, h], "opacity": 0..1}]}}
  ```

  for every `text_diff` transition, at every t (progress 0 before its window, 1 after). `tokens` holds every token of
  both items once each, named by the design's read-only anchor `#tok:k` (k the token's index in its item's
  `code.tokens`): a kept token is one entry naming both; a token only the from item has (deleted, or the old side of a
  changed token) is an entry with `to: null`; one only the to item has (inserted, or the new side of a changed token) an
  entry with `from: null`. A changed token is so two entries, the old one going as the new one comes. `box` is the
  token's box at t in document u, `[x, y, w, h]` as the `#tok:k` anchor reads it (the shaped run's layout, before any
  pixel rounding); `opacity` is its drawn opacity at t.
- **`eval {doc, t, pixels: true}`**: the frame as the canvas draws it, a PNG in the evidence store (`snapshots[0]`), as
  the base answers it (#535).
- **`frames {doc, count: 6, step: "1f"}`**: each frame's `ran`, the nodes that ran in it, as the base answers it.
- **`benchmarks/budgets.json`**, read by `scripts/benchmark.mjs`'s validator against the merge base's, and the task's own
  judge (`judgeTargets`) through #224's `judgeTask`.

### The documents

- **A code item** (#1965's, #1966's): `text@1` with `font: mono`, `size`, `paint.fill.role: ink`, `raw` (a string, ASCII,
  no digit, no number word, so a character's index is its byte offset and honest numbers counts nothing), and `code:
  {language: python, tokens}`, plus `numbers: false` where lines aren't numbered and `highlight: [{lines: [3, 5]}]`
  (default treatment, `dim_others`) where they are. `tokens` comes from the fixtures' highlighter (`tokensOf`): one
  token per word, operator, punctuation mark, string or comment, classed keyword, type, function, variable, string,
  comment, operator or punctuation.
- **A film** (#494's envelope): `{format: 1, id, profile: "film", title, description, size: [640, 360], camera: "cam",
  transport: {span: "2s"}, items, …}` with a still orthographic camera@1 `cam` over the page.
- **A text_diff between two code items**: `transitions.<ID> = {from: <item>, to: <item>, kind: "text_diff", at: "0.5s",
  span: "1s", progress: "linear"}`, the form the base gives a `match_morph` between two items (#494): `at` the time the
  window centres on (`align` left at center), so the window is [0 s, 1 s].

### The moving diff (AC1, and AC3's middle picture)

The film `moving-diff` holds `before` and `after`, both at `at.pos [60, 60]`, `size: 15.5` and `line_height: 20` (the
criterion's 20 u line; 1.3 × 15.5 rounds to 20 too, so a line height read from either agrees), `numbers: false`, and
the transition `td` from `before` to `after`:

```text
before (3 lines)              after (4 lines)
def greet(user):              def greet(user):
    send(user, out)               assert ready
    return user                   send(user, err)
                                  return user
```

Tokens by index (`#tok:k`): before `def greet ( user ) :` 0–5, `send ( user , out )` 6–11, `return user` 12–13; after
`def greet ( user ) :` 0–5, `assert ready` 6–7, `send ( user , err )` 8–13, `return user` 14–15. Lines align first (the
first and last lines are equal; `send(user, out)` is changed), then tokens inside the changed lines: `send(user, out)`
against `assert ready` and `send(user, err)`, whose only common tokens are the call's, so the alignment has one longest
answer and no tie: kept 0–5 → 0–5, 6–9 → 8–11, 11–13 → 13–15; `assert` and `ready` come; `out` goes as `err` comes (the
one changed argument). The kept tokens of the last two lines are before's 6, 7, 8, 9, 11, 12 and 13.

## Criteria to tests

Each test's name starts with its criterion's tag (`AC<n> #1968.<h8>`).

| Criterion | File (tests) | What it asserts |
|---|---|---|
| AC1 `#1968.4bf4e5fe` | `ac1-text-diff.test.ts` (3) | **(moves)** At every 60 fps frame of [0 s, 1 s] and seven times off that grid, read in order in one session: each kept token of the last two lines is one piece whose box has moved (0, 20 × t/s) u from its box at 0 s (10 u at 0.5 s, 20 u at 1 s, linear), within 0.001 u; each kept token of the first line hasn't moved. **(fades)** At every time read: each token of either item is in exactly one piece; the kept pieces are exactly the alignment above; the pieces from nothing are exactly `assert`, `ready` and `err`, and the only piece going to nothing is `out`; kept pieces are at opacity 1 (± 0.01). `assert` and `ready` fade in: 0 at 0 s, 1 at 1 s (± 0.01), never falling, and strictly between 0.01 and 0.99 at some time. `out` and `err` cross-fade: `out` falls 1 → 0 as `err` rises 0 → 1, their opacities sum to 1 ± 0.01 at every time, and both are strictly between 0.01 and 0.99 at some time. **(seeks)** The same times read last to first in a fresh session answer the same `diffs.td`, bit for bit (its JSON) |
| AC2 `#1968.161c44a9` | `ac2-budgets.test.ts` (1) | **(count, any machine)** `frames` of a film with a dot moving every frame and the still code item (below), and of the same film without it: over frames 2 to 6, Σ max(0, ran with − ran without) is 0. **(record)** `benchmarks/budgets.json` holds the task `canvas-code-film` (below): command, targets, margin 0.5, `criteria` naming `#1968.161c44a9`, `initialReason` naming #1968, and the lane's validator takes the file against the merge base's. **(times)** Only on a reference Mac at rest (`judgeLimit`'s rule on the machine and the load): the task's judge judges its four targets, a FAIL fails, anything but PASS is INCONCLUSIVE; elsewhere INCONCLUSIVE, never PASS |
| AC3 `#1968.84837e9c` | `ac3-taste.test.ts` (1) | The check run takes the screenshots and the recording from the canvas's own frames (The taste call), once the film block reports the diff `td` at 0.5 s, writes them to `docs/evidence/1968/` and prints each path and SHA-256; it reads the call from the file `DEEPBUILD_TASTE_1968` names: none, or one on other files or not yours, is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these passes |

### The budget record (AC2)

```json
{ "id": "canvas-code-film", "command": ["node", "benchmarks/canvas.mjs", "code-film"], "margin": 0.5, "limits": {},
  "targets": { "tokens_2000_lines_ms": 5, "diff_400_lines_ms": 20, "seek_10_min_ms": 5, "still_code_steps": 0 },
  "criteria": ["#1968.161c44a9"], "initialReason": "Issue #1968 first measurement: …" }
```

`tokens_2000_lines_ms`: a 2,000-line file's tokens mapped to runs on a change; `diff_400_lines_ms`: two 400-line versions
aligned at check; `seek_10_min_ms`: a seek into a 10-minute terminal recording; `still_code_steps`: a still code item's
steps per frame, a count, which `canvas.mjs judge` judges on any machine (it joins `COUNTS`), the times on a reference
Mac. The test runs the judge itself only on a reference Mac at rest; the window (§12a) measures every commit against its
merge base. The test's own count is the any-machine reading of the last target.

### The still code item (AC2's count, AC3's first picture)

A function in eight token roles, its lines numbered (the default), lines 3 to 5 highlighted, `size: 18`, at
`at.pos [60, 60]`:

```text
def greet(names: list, loud: bool) -> None:
    # say hello to every name
    for name in names:
        line = "hello, " + name
        if loud:
            line = line.upper()
        print(line)
```

### The taste call (AC3)

`deep-show run` shows three documents by the agent's session and takes each picture with `eval {t, pixels: true}`:

- `code-roles-highlight.png`: the still code item on a board of its own, at 0 s;
- `moving-diff.png`: the moving diff at 0.5 s, mid-move (the same `eval` with `film: true` must report `diffs.td`, so a
  build with no text diff fails there);
- `terminal-recording.png`: a test run's terminal recording played in a cell grid (64 × 14 cells of 8 × 16 px, #1967's
  `play` and recording format: `$ pytest tests/test_greet.py` at 0.2 s, two lines ending in a green `PASSED` at 0.6 s and
  1.0 s, `all tests passed` in bold green at 1.4 s), at 2 s;
- `diff-and-terminal.apng`: the moving diff from 0 to 1 s, then the terminal recording playing from 0 to 2 s, 20 frames
  a second (21 then 41 frames), each frame the canvas's own PNG, decoded and put into one animated PNG unchanged.

The PNGs are the evidence store's bytes as the canvas wrote them. Your call is a JSON file named by
`DEEPBUILD_TASTE_1968`:

```json
{ "criterion": "#1968.84837e9c", "by": "you", "screenshots": ["<sha256>", "<sha256>", "<sha256>"],
  "recordings": ["<sha256>"], "call": "looks_right" }
```

`call` is `looks_right` or `looks_wrong`. No test judges a picture.

## Wrong programs

Each judge first runs on planted wrong programs, made in test code from a clean model of the right answer, and must
fail each, naming what catches it; it must also pass the clean model (the fixture's boxes on a 9 u grid, kept tokens
moving linearly, the inserted and changed tokens fading). They hold before and after the work. The base itself is the
wrong program each test fails on.

- **(moves)** kept tokens on an eased progress (in-out cubic: right at 0.5 s and 1 s, wrong at 0.25 s); every line
  sliding, the first too; the changed line paired with the inserted one by position, so its kept tokens don't move;
  kept tokens jumping halfway. Also failed, unplanted: a move by another line height, a sideways move.
- **(fades)** the whole item cross-fading with no token kept; the inserted line shown whole from the start; the inserted
  line appearing only as the window ends; the changed argument swapped halfway; the changed argument dipping through
  nothing (`out` over the first half, `err` over the second); the changed argument kept as if its bytes were equal. Also
  failed, unplanted: a diff by characters or by display text, a token in no piece or in two, a kept token dimmed.
- **(seeks)** a seek one frame behind the play. Also failed, unplanted: any diff whose state depends on the frames read
  before.
- **(record)** a target loosened (`diff_400_lines_ms: 40`); the criterion not named; another margin; no reason; a frozen
  task of the merge base removed (the validator's refusal). The clean twin is the merge base's file with the task added,
  so the shape above is one the lane's validator takes.
- **(count)** a code item that runs a node every frame (`ran` 6 against 5 on frames 2 to 6).
- **(call)** no call, a call on another picture, a call that isn't yours (INCONCLUSIVE); `looks_wrong` (FAIL).

## Choices where the issue and design leave it open

1. **The answer** is the film block's `diffs` (above), beside #494's `morphs`: the design names the `#tok:k` anchors,
   so a piece names its tokens by them, and a box is the anchor's.
2. **A text_diff between two items in one film** takes #494's form for a match morph between items (`at`, `span`,
   `progress`); the Transition fields name `from, to` as placements, shots or strips, and the code section speaks of "a
   `text_diff` between two code items".
3. **"A 20 u line"** is `line_height: 20` with a size whose default line height is also 20.
4. **"Linear progress"** is `progress: "linear"`, and "10 u at 0.5 s and 20 u at 1 s" is read as the move at every time
   read: 20 u × t/s, so an eased move, right at both of the criterion's times, fails at the others.
5. **"Exactly"** is within 0.001 u.
6. **The changed argument** is in the last two lines, as "the kept tokens of the last two lines" says (not every token
   of them is kept), and as long as the old one, so the tokens after it keep their x. The inserted line shares no token
   with the changed line, so the alignment has one answer.
7. **"Fades in"** is 0 at the window's start and 1 at its end, never falling, partly drawn at some time;
   **"cross-fades"** is the old token falling 1 → 0 as the new one rises 0 → 1, their opacities summing to 1 at every
   time (the base's own cross-fade blends the sides at 1 − p and p) and both partly drawn at some time. When in the
   window a fade runs is left open: the criterion fixes the kept tokens' times only.
8. **The first line's kept tokens stay put and kept tokens stay at opacity 1**: the design's "kept tokens move to their
   new places" with both items at one place, and "fades in only the inserted line's tokens".
9. **"Seeking equals playing"**: the play reads every time in order in one session; the seek reads them last to first in
   another, each a jump back; equal is the same JSON.
10. **The budget task** (its name, its command, its target names, `still_code_steps` as the count of "costs nothing per
    frame", read as #2017's `still_steps` and #538's `idle_steps` are: nodes run with the item less without it, frames 2
    to 6).
11. **The pictures**: the files, their times, the recording's 20 fps, and one recording holding both motions (the
    criterion's "a recording of the diff moving and the terminal recording playing"); the call's file and its shape are
    #224's.

## What the base already does and these tests don't credit

At the base a still code item already costs no node per frame (AC2's two films, read by hand at the base: `ran` 16, 5,
5, 5, 5, 5 with it and 5 every frame without it), so AC2's count passes there; a code item with tokens and a highlight,
and a terminal recording played in a cell grid, already draw (#1965, #1966, #1967), which AC3's first and last pictures
lean on. None of it is credited.

## What is missing at the base (why each test fails)

- AC1, all three: `deep_show` refuses the film: `transition_kind` at `transitions/td/kind` ("motion.compile can't
  evaluate this"): a transition between two items lands only as a `match_morph`. The play is read once per file and its
  failure given to each test.
- AC2: `benchmarks/budgets.json` has no task `canvas-code-film` (the judges' plants and the count passed first).
- AC3: the same refusal of the moving diff's film, after the code item was shown; no file is written.

## Not tested, because no criterion says so

A deleted line closing and an inserted line opening its space (where the inserted and changed tokens are drawn), the raw
and display forms (#1965's tests), gutter marks and highlights in a diff, a text_diff over words of plain text, a quote
from a commit and the proof line's refusals (a mismatched quote, an unknown token class: #1965's tests), the 2,000-line,
400-line and 10-minute workloads themselves (the budget task's), and a terminal recording's seek beyond #1967's.
