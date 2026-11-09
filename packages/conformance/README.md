# @deepbuild/conformance

## What it is for

The one conformance runner and its kits (#313, #314, #349): the adapter kit with its fake agent and broken fakes, a kit per hub slot with its reference fill and planted wrong fills, the code families and their judgement, the codes pages, the closure rules and the schema generator. The preflight's kit and slot checks, the extension host, the CLI's `deep run`, `checks-command`, `env-local` and the proof package use it; `deep-conformance` (`src/bin.ts`) runs a kit on a fill.

## Where new code goes

- `src/index.ts`: the public entry; export only what callers need.
- `src/result.ts` and `src/slot-types.ts` are entries of their own (`@deepbuild/conformance/result`, `/slot-types`): the run result's shape check, and a kit's shapes with the `Finding` a judge ends a case with. A check kind the hub loads takes its values from these, so the hub starts without the kits, the fake agent and the generator; neither may import a kit.
- `src/slots/<slot>.ts`: a new hub slot's kit, listed in `src/slots/kits.ts`. Shared kit helpers go in `src/slots/shared.ts`.
- `src/kit.ts`, `src/runner.ts`, `src/fake-agent.ts`, `src/shipped.ts`: the adapter kit (adapter@1).
- `runtime/<kit>/`: scripts a kit loads into or starts as other processes; `fixtures/<kit>/`: a kit's fixed cases.
- `src/gate.ts`, `src/gate-play.ts`: the kit gate@1 (#33), `deep-conformance gate check|run`: its corpus in `fixtures/gate/`, played through `runtime/gate/agent.mjs` on the hub and deep-hook this checkout builds, started as processes, never imported.
- Tests: `*.test.ts` beside the source they test, under `src/`; this package has no `test/` folder.

## What it may import

Sits on the core: it reaches `@deepbuild/adapters` and `@deepbuild/contracts` through their package entries, plus `node:` built-ins. It never imports a fill it judges (checks-command, env-local), the extension host, the hub, the CLI or the app.

## Deviations

- `runtime`: plain `.mjs`, not compiled TypeScript, because each file runs in another process or thread: the check.kind reporter and tracer load into a suite's processes through `NODE_OPTIONS`, and the environment kit's fixture server, helper and probe worker run on their own (see each file's header).
- `fixtures/gate`: the seeded false dones, each with its clean twin and its expected verdict, one per row of the verdict table and per known way to fake a pass; the kit fails a gate that judges one otherwise, so never "fix" them. A `setup` names what no commit can make (a hub killed mid-run, a full disk, an injected judge fault the shipped hub can't yet produce, through `DEEP_HUB_TEST_JUDGE_FAULT`).
- `fixtures/check-kind`: small suites with known outcomes, several of them built to fail or hide a run (`known-fail`, `masked-exit`, `erases-evidence`); the kit compares each run against its expected outcome, so never "fix" them.
