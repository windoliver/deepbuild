# Blind redraft of one `#138.230a6b92` test (dispute #3648)

Dispute raised in [issue #3648](https://github.com/windoliver/deepbuild/issues/3648). This redraft was written
blind, from issue #138, the design (`docs/technical-design.md`, `docs/canvas-primitives.md`) and base commit
`e9c601b` only. No implementation, branch, PR or other issue was read. The first draft,
`tests/acceptance/138/manifest.test.ts`, is untouched. The owner decides whether this redraft replaces its one
disputed test.

The lanes swap tests by file. After the swap, the first draft's file runs only by hand. Its other three tests
are carried over unchanged into `manifest-rest.test.ts`, with the same names, bodies and timeouts:
- the category and naming-scheme test
- the kit test for the formula, the made-up check kind and the unlisted oracle
- "the shipped build's fixtures pass the same part"

## The criterion

> Every fixture is a document with a sidecar of existing check kinds and named oracles, and no sidecar holds a formula or code

(`#138.230a6b92`). Scope line: "fixtures as documents with sidecars of existing check kinds and named oracles
from the runner's closed list (reviewed test code)". Also from Scope: "no fixture marked may-fail".

## Side by side

| | First draft (`138/manifest.test.ts`, "each fixture holds a document and a sidecar of known keys, …") | Redraft (`manifest-keys.test.ts`) |
|---|---|---|
| Document | `format` number and `items` object, except scenes | same |
| Sidecar keys | closed at README's nine sidecar keys | same |
| Check kind | in `manifest.check_kinds` | same |
| Check keys | closed at nine: `kind, probe, at_times, expect, tolerance, except, render, sweeps, declared_cuts` | the nine common fields, **plus the check's own kind's fields**. A core kind may hold only the fields the design lists for it (`document.validate` + `assets`, `document.budget` + `lod`, the other nine core kinds nothing more). Any other kind's own field must be a plain field name, must not be a sidecar-level key (`oracle(s)`, `covers`, `codes`, `twin`, `expected_from`, `criteria`), and its fixture must run in the kit's `fixtures` part with no FAIL or INVALID case |
| Inside common fields | not checked | `render` closed at its five design keys; a pixel `tolerance` closed at `within, on, ceiling, window{size, off}, reason` |
| Oracles | `sidecar.oracles` on the closed list | same |
| `expected_from` | one of four | same |
| Formula or code | regex over every non-prose string | same regex, same scope |
| May-fail | only as an unknown sidecar key | a may-fail key (`may_fail`, `xfail`, `skip`, `waived`, `must_pass`, …) at any depth, or a "may-fail" value |
| Proof that it can fail | none in this test (the separate kit test covers `test.kit.formula`) | a second test runs the same scan on the `test-kit-formula` build's manifest. It must catch the formula in `formula-expect`, the made-up kind in `formula-kind` and `eyeball` in `formula-oracle`, and report nothing for any other fixture |

## Why the first draft can't pass beside `#138.9e9940d1`

`#138.9e9940d1` says every catalog code needs a planted fixture that emits it, and the kit runs each sidecar
check on its fixture as that check kind's input. The design gives most check kinds fields beyond the nine:

- In `canvas-primitives.md`, "Check input" defines `{kind, probe, at_times, expect, tolerance, except, render,
  sweeps, declared_cuts}` as the shape every check shares. It says every other kind belongs to "the canvas
  module's that registers it".
- Each "Check input: …" section adds that kind's own fields, written beside `kind` at the top level of the check:
  - `scene.scale {sizes, tolerance}`
  - `camera.framing {keep, inside, margin, fill, cut, horizon_max, overlay}`, which also gains `occluded_max`
    and `occluded_samples`
  - `asset.validate`'s `tool`
  - `physics.query`'s `state` beside `probe` and `expect`
  - `logic.layout {saves, steps, same}`
  - `net.feel {players, steps, profile, seed, items, bounds}`
  - `rules.legal {playtest, samples, unlisted, seed}`
  - `catalog.reach {catalog, roots, makes, every}`
  - and more
- Even the core's own kinds gain fields: "`document.validate` gains `assets` …; `document.budget` gains `lod`"
  (Check input: loop kinds, Extended kinds).

A code fixture for a kind that needs its own fields has to carry them, or its check can't run as that kind's
input and can't emit the code. Under the nine-key list it fails `#138.230a6b92`. Without those fields it can't
meet `#138.9e9940d1`. So the claim holds: the nine-key closure is the README's quotation of the shared shape,
read as if it were the whole input of every kind. The design doesn't read it that way. The criterion doesn't
need it either: it asks for existing check kinds, named oracles and no formula or code, and nothing about a
fixed key list.

## The rule chosen, and from where

A check's key belongs when it is one of the nine common Check input fields or a field of that check's own kind.

- **Common fields:** `canvas-primitives.md` "Check input: Fields". Inside them, `render`'s keys come from the
  same line, and the tolerance shape from README "Sidecar" (design: `technical-design.md` 2542, a share with a
  ceiling, a window and a reason).
- **The core's kinds** have their full field list in the design: the eleven kinds named in "Check input:
  Semantics", plus the two extensions in "Check input: loop kinds". For them the redraft is exactly as strict as
  the first draft, except for those two fields.
- **Any other kind's fields** are owned by the module that registers it ("Every other kind is the canvas
  module's that registers it"). The design can't list them all, and the R2 modules' kinds aren't in it. The
  design's rule for a field a schema doesn't define is refusal: "four mutations each surface must refuse …
  an unknown field" (`technical-design.md`, "Generated edges and exact issues"), and `unknown_field` for a
  document (`canvas-primitives.md` 349). So a kind-own field is checked where the kind's schema lives. The kit
  runs that fixture's checks as their kind's input (README part `fixtures`), and the fixture must have cases
  there, none FAIL or INVALID. BLOCKED stays allowed, because a probe noop can't make is BLOCKED by design.
- **Sidecar-level keys inside a check** are refused. The keys `oracle(s)`, `covers`, `codes`, `twin`,
  `expected_from` and `criteria` decide verdicts at the sidecar (README "Sidecar"; the kit reply's
  `criteria`). Inside a check, they would be a second source that the oracle and code readings never see. One
  example is an oracle off the list hidden in a check.
- **May-fail marks** are refused anywhere in the sidecar. Design: "no fixture may be marked may-fail" and
  "nothing skipped silently" (`technical-design.md` 2538). Only your decision waives a fixture (issue
  criterion, "Only your decision … waives a fixture").

## What the redraft still catches

- A formula or code in any non-prose string of a sidecar, including in a kind's own fields. This uses the first
  draft's regex, unchanged, and is proven on `formula-expect`.
- A check kind no registry holds, proven on `formula-kind`.
- An oracle off the closed list, proven on `formula-oracle`.
- An unknown sidecar key, may-fail among them, and a may-fail mark at any depth.
- On a core kind: any key outside the nine and its design-listed extension.
- On any kind: an oracle, coverage, codes, twin, provenance or criteria key hidden in a check; a key that isn't a
  field name; and a stray key inside `render` or a pixel `tolerance`.
- On a module kind: an own field that makes its check fail or read INVALID in the kit. An own field the
  implementation silently ignores is not caught here.

## Limits, stated

- No surface in README lists a module kind's input fields, and the README defines no planted sidecar with a
  stray key. So the kit cross-check trusts that a kind refuses a field it doesn't define, as the design
  requires. Proving that refusal needs a planted fixture with a stray own key. That is a README addition for
  the owner, not something this job may make.
- The core-kind field list holds only what the design spells out. If the design defines more fields for a core
  kind elsewhere, this test would flag them, and the list should grow by the design, not by the implementation.
- At base `e9c601b` both tests fail at an assertion. There, `useBuilds`'s "the binary builds" expectation fails
  on cargo's error (README: the base does not build). With the base's missing `cell` restored, `run`'s
  `ok`/one-reply expectations fail instead, because there is no `manifest` call. Not run here: another job runs
  the tests.
