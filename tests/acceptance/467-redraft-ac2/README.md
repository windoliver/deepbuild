# Blind redraft: #467 AC2's status-role test

Redrafted by the same blind job that wrote `../467/`, from the issue, the design and base commit `92aee55f`, without
seeing any implementation (design: Dogfooding; AGENTS.md, Proof). Only one test is redrafted; `../467/` is unchanged.

## What was disputed, and why

`../467/paint.test.ts`, test "a status role is refused in each of the four", built each document as
``card(`status-${name}`, …)`` with `name` a description such as "the inner shade". A document ID with spaces is outside
the ID grammar, so a correct check refuses it with `bad_id` beside `status_color_unbound`, and the assertion that
`status_color_unbound` is the only error can't hold on any correct program (it fails at "the inner shade" with
`['bad_id', 'status_color_unbound']`). The fault was the test's document IDs, not the criterion's reading.

## The redraft

`status.test.ts` keeps the test's intent and assertions unchanged: for glow, the inner shade, bevel (its highlight) and
satin, each naming `status.pass` on the card's text `word`, `deep-canvas-render check` answers `ok: false` with exactly
one error, `status_color_unbound`, whose `ids` hold `word`; and the same four in data roles (`../467/helpers.ts`
`ALL_FOUR`) raise no error. The only change is the document IDs, now inside the grammar: `status-glow`,
`status-inner-shade`, `status-bevel`, `status-satin` (and `status-none`, as before).

It reuses `../467/helpers.ts` by import (the binary build, `check`, the card and the look). Run it on every platform:

```sh
npx vitest run --root tests/acceptance/467-redraft-ac2 --no-file-parallelism
npx tsc --noEmit -p tests/acceptance/467-redraft-ac2
```

It builds `deep-canvas-render`, so it belongs in `scripts/lanes.mjs`'s `alone` list beside `tests/acceptance/467/`.

At the base it fails on its assertion: the four new paint fields aren't read, so the check passes `status.pass` in
them. It wasn't run there beyond the type-check.
