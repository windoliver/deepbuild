# @deepbuild/conformance

## What it is for

The one conformance runner and its kits (#313, #314, #349): the adapter kit with its fake agent and broken fakes, a kit per hub slot with its reference fill and planted wrong fills, the code families and their judgement, the codes pages, the closure rules and the schema generator. The preflight's kit and slot checks, the extension host, the CLI's `deep run`, `checks-command`, `env-local` and the proof package use it; `deep-conformance` (`src/bin.ts`) runs a kit on a fill.

## Where new code goes

- `src/index.ts`: the public entry; export only what callers need.
- `src/slots/<slot>.ts`: a new hub slot's kit, listed in `src/slots/kits.ts`. Shared kit helpers go in `src/slots/shared.ts`.
- `src/kit.ts`, `src/runner.ts`, `src/fake-agent.ts`, `src/shipped.ts`: the adapter kit (adapter@1).
- `runtime/<kit>/`: scripts a kit loads into or starts as other processes; `fixtures/<kit>/`: a kit's fixed cases.
- Tests: `*.test.ts` beside the source they test, under `src/`; this package has no `test/` folder.

## What it may import

Sits on the core: it reaches `@deepbuild/adapters` and `@deepbuild/contracts` through their package entries, plus `node:` built-ins. It never imports a fill it judges (checks-command, env-local), the extension host, the hub, the CLI or the app.

## Deviations

- `runtime`: plain `.mjs`, not compiled TypeScript, because each file runs in another process or thread: the check.kind reporter and tracer load into a suite's processes through `NODE_OPTIONS`, and the environment kit's fixture server, helper and probe worker run on their own (see each file's header).
- `fixtures/check-kind`: small suites with known outcomes, several of them built to fail or hide a run (`known-fail`, `masked-exit`, `erases-evidence`); the kit compares each run against its expected outcome, so never "fix" them.
