# Blind redraft of #111's tool-call test (`#111.ddf55f68`)

I read issue #111, `docs/technical-design.md` (Dogfooding, deep-hook, Before each command), `AGENTS.md`, this suite's first draft (`../README.md`, `../helpers.ts`, `../revive.test.ts`, `../BASE-FAILURE.txt`), `tests/acceptance/316/helpers.ts`, and the base's guards: `crates/deep-hook/default-rules.json`, `crates/deep-hook/src/matcher.rs` (`adds_dependency`), `packages/hub/src/standing.ts`, `guards.ts`. The base holds `npm install <x>` with the hub up, exit 2 and an ask ("No plan names it"), whatever `<x>` is, so no install can be a "runs" line. The lines that must run are `sh scripts/live.sh <word>`, which no base guard matches: `rabbitmq` (nobody rejected it), `nats` (only the assistant called it rejected), `kafka-lite` (a longer name), and `kafka` in the other repo. `sh scripts/live.sh kafka` in the repo you rejected it for must be denied citing `decision:<id>`, and so must `npm install kafka`, with no ask naming it. The test runs the "runs" lines first, so the base run below shows them passing through the real hub. A scratch probe, since deleted, confirmed the hub saw the call (`session.start` in the record) and that `npm install grpc` is held. Readings are the first draft's Invented items 4 and 5. The `npm install kafka` line never ran on the base, because the test stops at the first denial; that it should beat the dependency hold is my reading of the criterion, and a person shouldn't be asked what they already rejected (invariant 4).

## Base output (244a3455, Node 24.22, macOS)

```
 ❯ redraft/tool-call.test.ts (1 test | 1 failed) 9163ms
   ❯ #111.ddf55f68 a tool call that revives a direction you rejected (1)
     × #111.ddf55f68 is denied by deep-hook citing decision:<id>; a call that doesn't revive it runs, a longer name is another key, and the same call in another repo runs 8682ms

 FAIL  redraft/tool-call.test.ts > #111.ddf55f68 a tool call that revives a direction you rejected > #111.ddf55f68 is denied by deep-hook citing decision:<id>; a call that doesn't revive it runs, a longer name is another key, and the same call in another repo runs
AssertionError: the revival is denied: exit 0, stdout "", stderr "": expected 'allow' to be 'deny' // Object.is equality

 ❯ redraft/tool-call.test.ts:39:73

 Test Files  1 failed (1)
      Tests  1 failed (1)
```
