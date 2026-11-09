# @deepbuild/checks-work

## What it is for

R2's checks for work beyond code (#68), each a `check.kind@1` plug-in under the same rules as the core's: `service` (an endpoint's shape, latency and throughput floor, from where its users are), `data` (the rows or totals a query must return), `document` (every claim cited, every number matching its source) and `message` (delivered, and acknowledged where the channel can say so). Each kind declares its budget per run and ships its own kit with a planted fault it catches. A runner returns a run outcome, never a verdict, and `draftChecks` keeps a proposed check only where an installed kind runs it, turning every other requirement into an early question. The hub holds the four kinds in its kind table (`packages/hub/src/kinds.ts`, #1537); `tests/acceptance/68` drives them.

## Where new code goes

- `src/index.ts`: the plug-in entry, each kind's budget and its fill (`workFill`, `workKit`); `src/types.ts`: the shapes.
- `src/run.ts`: one run, the kind's work in `runtime/probe.mjs` in a process group of its own so the deadline can end it.
- `src/kit.ts`: each kind's `check.kind@1` kit with its planted fault; `src/draft.ts`: the drafting job's pick of kinds.
- Tests: `test/`; the acceptance suite in `tests/acceptance/68` is never edited.

## What it may import

A plug-in on the core: only `@deepbuild/conformance` and `node:` built-ins, through their public entries. It never imports the record, the hub, CLI or app.

## Deviations

None.
