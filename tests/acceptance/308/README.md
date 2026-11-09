# Acceptance tests for #308: the input module, `control@1` with its kit, and the input track's handling

Written first, from issue #308 ("Input module: controls, the control@1 registry with its kit, and the input track's
handling": its Scope, Fields, fifteen acceptance criteria and Proof), the design sections it links
(`docs/canvas-primitives.md`: Scope and input classes, Control, Control: kinds as a registry, Input track, Tour;
`docs/technical-design.md`: Control and input track, Canvas modules, Dogfooding) and the base commit `c469fe2e`, by a
job that never saw an implementation; none exists. The surface conventions come from the suites of #372 (the
`deep-canvas` binary's JSON lines), #200 and #185 (`deep-show run`: `registries`, `schedule`, `kit`, the seal's
startup refusal, packs, `--planted`) and #489 (the follow transition and the follow channel on a control). The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

Run them:

```sh
npm ci                      # once, if node_modules is missing
npx vitest run --root tests/acceptance/308 --testTimeout=600000
```

Add `--no-file-parallelism` on a shared Mac: each file builds what it drives (`cargo build --locked`, cached after
the first file), with `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0` unless you set them. The suite uses only node
built-ins and vitest and type-checks under the root `tsconfig.json`'s strict options
(`node node_modules/typescript/bin/tsc -p tests/acceptance/308/tsconfig.json`). A run leaves Vitest's cache in
`tests/acceptance/308/node_modules/.vite`; delete it. `BASE-FAILURE.txt` is the run at the base: every test fails
there because the surface doesn't exist.

## The surface under test

The issue names no code API. **Every name below that the issue or design doesn't give is this job's choice**, the
smallest surface consistent with the design and the base; the implementer builds exactly these, or a dispute goes to a
blind redraft. Three places, all existing protocols (one JSON object per line in, one per line out, in order, exit 0):

1. **`deep-canvas input`**, a new subcommand of #389's binary (`target/debug/deep-canvas`), for controls and the
   input track's handling.
2. **`deep-show run`** (#305, #200, #185, #138, #306) for the seal, `control@1`'s listing and kit, the pack check and the
   build without the module.
3. **Cargo features and `--planted` names** of `deep-show` and `deep-canvas input` for the planted programs.

### 1. `deep-canvas input`

Input, one run per line:

```
{"doc": Document, "viewport": [w, h], "fps"?: [p, q] = [60, 1], "host"?: "app" | "web_player" = "app",
 "reduced_motion"?: bool = false, "planted"?: name, "fill"?: {"control": ID, "count": n}, "summary"?: bool,
 "ops": [Op]}
```

The document is the session's document (every fixture is a 640 × 360 board whose 2D camera is the frame, so a pointer's
px are the document's u). The ops play in order on the session's one input track, which starts empty, with the
playhead at 0. `fps` is the rate the session is played at: gestures reach the input module on frames at that rate, but
an entry's stamp comes from its op's `t` and never from the frame (Input track: "no stamp depends on the frame rate").
`host` is the app or the web player's build of the same module: same entries, same hash. `reduced_motion` is the
viewer's preference (`tour` never runs under it). `planted` names a planted program (below; any other value is
`bad_input`, as at the base). `fill` appends `count` entries of yours for the slider `control` before the ops: entry
i (from 0) at flick `(i + 1) × 1000`, value `(i mod 1000) ÷ 1000`. `summary: true` leaves `track` out of the answer.

Output: `{"ok": true, "hash": hex, "fork_at": flick | null, "track": [Entry], "entries": n, "results": [Result]}`, one
result per op, or `{"ok": false, "code": …}` (the tests don't send a document that fails its check).

- `hash`: the input track's hash after all the ops (any non-empty text; the tests compare, never decode it).
- `track`: the entries as the core records them (Input track: fields): `{"t": flick, "seq": u32, "control": ID,
  "value": JSON, "samples"?: [{"t": flick, "value": JSON, "at"?: [x, y]}], "writer": "you" | "tour" | "agent",
  "serial"?: u32}`. `serial` is the gesture serial: present on every entry of writer `you`, absent on `tour` and
  `agent` entries. `value`: slider, turn and drag_along a number; a choice its option's ID; stages a stage's ID;
  press `1`. One gesture is one entry carrying its polyline in `samples` (the resolved values at the gesture; a
  drag_along sample also carries `at`, the handle's resolved position in u); the entry's `value` is its last
  sample's. An entry's `t` is the flick of its gesture's first event (a drag's press); with no logic item and no sound
  playing, its stamp is its event's `t` exactly (the input lead is one step while silent, and there is no step).
  `entries`: the track's length.
- `fork_at`: the track's `fork_at`, `null` until a fork.

Ops (`t` is a whole number of flicks, the platform's timestamp of the event; an op with a `t` plays the playhead to it,
`seek` moves it anywhere; an op's result is below):

| Op | Meaning | Result fields |
|---|---|---|
| `{"op":"pointer","phase":"down"\|"move"\|"up","at":[x,y],"t","mods":[…]}` | a pointer event in viewport px. `mods` is the modifier set held at that event (`shift`, `cmd`, `alt`, `ctrl`); a modifier change mid-drag is a `move` at the same place with the new set. A drag's entry is appended on `up`. Hover is a `move` over a hover control's target | `value`: the value of the control being dragged (or, over a hover control's target, that control's target value) right after the event, as the handle shows it, else absent; `appended`, `dropped` |
| `{"op":"key","control":ID,"key":K,"phase"?:"down"\|"up"="down","repeat"?:bool,"mods":[…],"t"}` | a key event for the focused control `control`; `K` is the DOM `KeyboardEvent.key` (`ArrowRight`, `PageUp`, `End`, `Enter`); `repeat: true` is an auto-repeat while held. A press, with its default key effect, is one entry | `value` after the event; `appended`, `dropped` |
| `{"op":"control","control":ID,"value":JSON,"t"}` | a programmatic entry of yours (as #372's `control` input: a whole gesture, with its serial) | `appended`, `dropped` |
| `{"op":"tool","control":ID,"value":JSON,"t"}` | the parameter tool setting `control`: one entry, writer `agent`, no serial | `appended`, `dropped` |
| `{"op":"seek","t"}` | moves the playhead; no entry | `dropped: 0` |
| `{"op":"advance","t"}` | plays the playhead forward to `t` with no gesture (the tour writes its entries) | `frames`, `input_work` (units of work the input module did over those frames; 0 when there is nothing to do), `appended` |
| `{"op":"drag","at":[x,y],"delta":[dx,dy],"t"?}` | #372's viewer drag: in 2D a plain drag pans the camera; no entry | – |
| `{"op":"read","control"?:ID,"channel"?:ID,"t","mode"?:"live"\|"golden"\|"export"}` | the value a driver reads at the playhead (the tests always seek or advance to `t` first). Of a control: the last entry at or before `t` (a choice reads its option's index, `-1` with no default and no entry; a view or viewer control its session value with its smoothing; `golden` and `export` read what a golden or an export draws: view and viewer controls at their `default`). Of a follow channel (#489): its value | `value`; for a control, `count`: the number of entries of that control at or before `t`; for a channel, `solves` (segment solves so far in this run, across seeks and forks) and `segments` |
| `{"op":"lookup","control":ID,"times":[flick],"runs":n}` | the budget probe: looks up the control's value at each time, `runs` times over | `values` (the first pass's), `ns` (the whole probe's wall time) |

`appended` and `dropped` count the entries the op added to and dropped from the track (an op that forks reports the
dropped later entries; the answer's `fork_at` is the last fork's flick).

Seek versus edit (Input track: Semantics) is the answer's behavior: a `seek` changes nothing; a gesture's entry where
later entries exist forks the track at its flick (`dropped` = the later entries, `fork_at` set, hash changes).

### Documents

The board of #372 (`format`, `id`, `profile: board`, `size`, `camera`, `layers`, `items` with `kind: test.rect@1` and
the camera item) plus `controls` as Control defines them, and, where a test needs it, `tour` (Tour: fields) and
`channels` (#489: a follow channel `source: "controls/<id>/value"`). `test.rect@1` is #372's test kind (`w`, `h`,
`fill`; `at.pos` its top-left corner).

- **Slider geometry (this suite's reading of `handle`).** `handle: {item, along: "x", travel: 200, drag: "along"}`:
  the handle's centre sits at the item's authored centre when the value is `range[0]`, and moves `travel` px (here
  also u) along the axis as the value goes to `range[1]`. The fixtures' track is `x` 100 to 300 at `y` 180, the knob a
  20 × 20 `test.rect@1` authored at (90, 170). A press on the knob grabs it; a press on the track elsewhere moves the
  value to that point.
- **drag_along.** `handle.along: {"polyline": [[x, y], …]}` (a literal path in u, this suite's reading of `along:
  path`); the control's value, `range [0, 1]`, is the fraction of the path's arc length, and the handle is always at
  that point. The fixture's rail is [[100,100],[300,100],[300,250]] (350 u).
- **choice.** `options: ["a", "b", "c"]` (option IDs, which are their labels), `verb: "pick"`, `targets: {a: item, …}`:
  a pointer down and up on a target is the pick.
- **stages.** `stages: {"a": {label, keys: ["1"]}, …}` with `default`; the entry's value is the stage's ID.
- **press.** `keys: {"Enter": 1}`, no `binds`.
- **hover.** `kind: "hover"`, `class: "view"`, `range: [0, 10]` (the lift in u when the pointer is over the target),
  `default: 0`, `targets: {"over": "card"}`, `smoothing: {"follow": {"transition": {"span": 0.3, "interp": {"ease":
  {"name": "out_cubic"}}}}}` (#489's transition model, seconds as numbers).
- **tour.** `tour: {keys: {gain: [[t_s, value, "hold"], …]}, idle_after: 1.4, resume_after: 3.6, loop}` with `hold`
  keys only (an interpolated key would write an entry per frame, which no stamp may depend on); `t_s` seconds on the
  tour's own clock, which starts at 0 when the tour starts.

### Planted names of `deep-canvas input` (`"planted"`)

`slider_absolute` (the slider reads the pointer's absolute place), `shift_recompute` (a Shift change recomputes the
value from the total travel at the new speed), `no_anchor_move` (past a limit the anchor doesn't move),
`kind_reads_modifiers` (modifiers are read at the frame that handles the event, not carried by it),
`drag_along_recompute` (the entry's value is computed again from the stored pointer and the current camera at
replay), `transport_forks_on_scrub` (a seek drops the entries after it), `tool_stamps_you` (the parameter tool's
entry is stamped `you`), `tour_writes_during_drag` (the tour doesn't yield to your gesture), `smoothing_fall_from_peak`
(a transition changing mid-way starts from its old target, not where the value is), `scanning_lookup` (the lookup scans
the track).

### 2. `deep-show run`

Everything is the base's call set (#305, #185, #200, #138, #306) and the build set `full`. What the tests read:

- `{"call": "registry"}`: `modules` includes `"input"`; `digests.input`.
- `{"call": "schedule"}`: `interfaces["input@1"] = {"module": "input", "digest": …, …}`, the digest equal to
  `registry.digests.input`.
- `{"call": "kit", "modules": ["input"], …}`: module `input` PASS, with parts `replay`, `keyboard` and `input`, each PASS.
- `{"call": "registries"}`: `control@1`: `owner: "input"`, `fill: ["module"]`, `resolve: "seal"`, `kit` rules `replay`,
  `read_region`, `keyboard`, `input` (each rule a kit part), exactly nine entries (slider, toggle, choice, stages,
  transport, drag_along, turn, press, hover), each `origin: "first_party"`, `module: "input"`, `kit` PASS with the four
  rules PASS, and `value: {classes: [document|view|viewer], sources: [pointer|keys|wheel|…], read_region: {bytes,
  layout}, role, keyboard}` (Control: kinds as a registry: Entry); and `planted`, one entry or more for each of the four
  parts, each `result` FAIL with a failing rule named for that part and the planted entry's name in its result.
- `install_pack` of `fixtures/packs/dialpack-1.0.0` (its `pack.json` declares `entries: {"control@1": [dialpack.dial]}`):
  `packs` lists it `refused`, an error naming `control@1` and `module` (as #200 does for `gpu.step@1`).
- The seal's startup refusal (#305, #200): exit 2, one line `{"ok": false, "code": "seal_refused", "reason":
  "entry_refused", "registry": "control@1", "entries": [kind names], "rules": [kit parts], …}`.
- `eval` and `deep show` (`present`): a film with no controls gives the same `nodes` (every key and every written
  byte) with and without the input module; a document with a slider in the build without the module is refused with
  `module_missing`, the reply naming `input`.

Features and startup arguments (in no shipped build):

| Name | What it is |
|---|---|
| feature `test-leave-out-input` | the full set without the input module (as `test-leave-out-motion`) |
| feature `test-control-kind` | a test canvas module `test.dial` filling one entry `test.dial` into `control@1` (a number control with a role, a keyboard path, no agent input, computed once at the gesture); it seals and passes the kit unplanted |
| `--planted control_kind_recompute` | `test.dial`'s entry is computed again from the camera at replay: refused, rule `replay` |
| `--planted control_kind_reads_modifiers` | `test.dial` reads modifiers at replay: refused, rule `replay` |
| `--planted control_kind_no_keyboard` | `test.dial` has no keyboard path: refused, rule `keyboard` |
| `--planted control_kind_agent_input` | `test.dial` takes an entry from an agent's input: refused, rule `input` |
| `--planted input_drag_along_recompute` | the shipped `drag_along` computes its entry again from the camera at replay: refused, `entries` names `drag_along`, rule `replay` |
| `--planted input_tool_stamps_you` | the parameter tool stamps its entry `you`: refused, `entries` names `slider`, rule `input` |

## Criteria to tests

Each test's name starts with its criterion. The issue has fifteen checkboxes; AC1 to AC15 are them in their order.

| ID | Criterion (short) | Test, and how a failure names it |
|---|---|---|
| AC1 | replay at 30/60/120 fps to one hash; planted drag_along recompute; film without the module; slider doc `module_missing` | `module.test.ts` (3): the session of a slider drag, a stages pick and a drag_along drag, then a camera pan, seek and read, at 3 rates: one hash, and `rail` reads at the replay what its entry recorded; planted fails naming `rail`. The sealed set, schedule and kit; `--planted input_drag_along_recompute` refused naming `drag_along`. A film's `nodes` equal in `full` and `full,test-leave-out-input`, and the slider doc `module_missing` naming `input` only in the second |
| AC2 | control@1's nine entries, each passing the kit; planted kinds; pack | `module.test.ts` (3): the listing; `test.dial` sealing unplanted and refused in `replay`, `keyboard` and `input`, naming it; the pack refused naming `control@1` and `module` |
| AC3 | a dragged point never leaves its path; one drag, one change | `track.test.ts`: two drags that wander off the rail past both ends; every sample on the polyline and at the path's point for its value; two entries |
| AC4 | choice index: -1 with no default and 2 after the third; 1 for a second-option default | `track.test.ts`: reads before and after a click on the third option's target, and after a seek back |
| AC5 | a press: one entry per press, none held, same count seeking and playing | `track.test.ts`: three presses of yours (one held with repeats) and two of the tour; counts at six times by play and by shuffled seeks; writers |
| AC6 | 30 entries scrubbed 50 times; play-on values; fork at 20 s; planted transport; follow channel and fork | `track.test.ts` (3): the scrub (300 seeks with reads), 3 play-ons, the planted `transport_forks_on_scrub` failing at the first scrub naming `gain`; the fork at 20 s (11 entries, `fork_at` = 20 s, 20 dropped, hash changed); the follow channel with 12 entries and a drag after a seek to 5 s (fork at 5 s, 8 dropped, 1 to 3 segment solves against none for the seek) |
| AC7 | the parameter tool's entry, stamped agent; planted tool | `track.test.ts`: one `agent` entry without a serial, your entry untouched, the replay reads 0.8 at 3 rates; planted fails naming `gain`; `--planted input_tool_stamps_you` refused at the seal, rule `input`, naming `slider` |
| AC8 | no work per frame without controls; O(log N) lookup; planted scan | `budgets.test.ts` (2): `input_work` 0 over 10 s at 60 and 120 fps (and non-zero for a tour); five ratios of per-lookup time at 100,000 and 10,000 entries judged against 2 on a reference Mac, the planted scan judged FAIL; elsewhere INCONCLUSIVE after the values were checked |
| AC9 | tour: 3.4 s, none from 5 s, resumes, none under reduced motion, one hash; planted | `track.test.ts`: first tour entry at exactly 3.4 s, none in [5.0, 9.1) s, one in [9.1, 10.2] s, writers and serials, 3 rates one hash; reduced motion none; the planted tour fails naming `gain #<seq>` |
| AC10 | hover transition numbers; golden at rest; planted fall | `track.test.ts` (2): lift 8.75, 10, 1.25, 0 and 25 times on each curve; golden and export 0; leave at 1.1 s from 7.037037 and on `v0 × (1 − out_cubic)`; planted fails naming `card` at 1.1 s |
| AC11 | off-centre press, 20 px drag | `grammar.test.ts`: 0.5 on the press and after 2 px, 0.585 after 20 px, one entry of 0.585; the track press reads 0.75; planted absolute reads 0.63 |
| AC12 | Shift mid-drag, 40 px = 0.01, no jump | `grammar.test.ts`: the change moves the value by at most 0.005, 40 px under Shift by 0.01 within 1e-9; planted recompute jumps |
| AC13 | 100 px past the max, 10 px back = 0.95 | `grammar.test.ts`: 1.0 then 0.95; planted with no anchor move stays 1.0 |
| AC14 | Shift pressed and released mid-drag, one hash at 3 rates; planted kind reads modifiers | `grammar.test.ts`: one hash and one track; planted gives another, naming `slider`; `--planted control_kind_reads_modifiers` refused in `replay` naming `test.dial` |
| AC15 | keys: Shift+Right 0.005, Page Up 0.1, End to 1, app and web player | `grammar.test.ts`: eight keys from 0.5 by increment 0.05; `host: "web_player"` gives the same results and hash |

Numbers are compared at 1e-9 (values are f64 JSON numbers, computed in f64) wherever the issue gives them; the issue
gives no rounding.

## Readings where the issue and design leave a choice

- **Surface names, geometry and fixtures** are listed above; the issue gives none.
- **The 3 px threshold.** 0.585 = 0.5 + (20 − 3) ÷ 200: motion inside 3 px of the press is discarded once, at the start
  of the drag, and the 20 px drag then moves the value by the 17 px beyond it. It is not applied again after a Shift
  change (AC12 needs exactly 0.01 for 40 px at 1/20 speed: 40 ÷ 20 ÷ 200).
- **"100 px past the max."** The slider starts at its max (1.0) and the pointer moves 100 px right of the handle, then
  10 px back; with the anchor moved by the overshoot the value reads 1 − 10 ÷ 200 = 0.95 whatever the threshold.
- **The gesture's time.** An entry's `t` is the flick of its gesture's first event; "a drag while paused at 20 s" is a
  press, moves and release all at `t` = 20 s, and the fork is at 20 s. The tour's "your last gesture" ends at the
  release; "resumes 3.6 s after that gesture ends" is tested as no tour entry before 9.1 s and one within 1.1 s after it,
  since the design doesn't say whether a resumed tour restarts its keys or continues them. The first entry is exact: the
  first key (t 0) fires 1.4 s after the last release.
- **A tour's entries carry no serial** (Tour: it can never count as your gesture); the parameter tool's neither.
- **"The golden and an export draw the card at rest"** is `read` with `mode: "golden"` and `"export"` giving the hover
  control's `default`: a hover is viewer state, left out of goldens (Scope and input classes).
- **"Rebuilds only the segments from the fork on"** (AC6) is read as 1 to 3 segment solves after the fork, against at
  least 4 for rebuilding the four segments before it, and none for the seek back; the segment count is #489's.
- **The planted transport's hash change on the first scrub** (AC6, the follow clause) is checked by the plain scrub
  test (hash, entries and `dropped` of the first seek), which the same plant fails; the follow run itself is not
  repeated on the plant.
- **"The kit's input part … naming the control"** (AC7) is the seal's refusal naming the control kind `slider`, the kit
  fixture's own control IDs being the implementer's.
- **A kit part's name** is `replay`, `read_region`, `keyboard`, `input` (the design's Kit field); control@1's planted
  entries' names are the implementer's, and the test finds each part's by its failing rule.
- **A choice's entry value** is the option's ID; the driver's `read` gives the index.

## Not tested, and why

- **AC8's merge-base comparison.** "Compared with the merge base": the base has no input module, so its per-frame input
  work is none by construction and the test asserts the count 0; a timing of the whole frame against a base build would
  be a second build of the merge base, and the criterion's two named numbers (0 work; the lookup ratio under 2) don't
  need it. The ratio is a timing and runs only on a reference Mac (INCONCLUSIVE elsewhere).
- **AC9's pointer glide** (`tour.pointer`), `loop` and `resume_after` beyond the window above: no criterion.
- **The card's drop shadow** (blur 6 → 22 px, y 2 → 12 px, opacity 0.08 → 0.22) in AC10: the cards belong to the
  figures task (#76), which the issue leaves out; the shadow's mix is the card's own mapping of the same smoothed value,
  which this test pins numerically through the lift. A test of the drawn shadow would need a card kind this task
  doesn't ship.
- **`keys` overrides, ⌘ snapping to `increment`, `turn`, `toggle`, `transport` and `press` with `binds`:** in the scope
  but in no criterion beyond the registry listing (each kind's kit result).
- **"No hidden cursor and no warp" and "thresholds from the table in #1466"**: a statement about the app's pointer
  handling and a table this job can't read; no number in a criterion depends on them but the 3 px.
- **The Oracle lane.** The issue's oracle page (`doneright/oracles/issues/308.md` in `DeepBuildAI/deepbuild`, branch
  `doneright`) can't be read by this job. These tests are the local proof for every criterion; whether other projects'
  tests also check any of them is **BLOCKED** here with one unblock ask: give the runner read access to that path and
  the runner of #136.
