# @deepbuild/extension-host

## What it is for

The extension host (#348-#351): loads a package in the hub's process when it is inside DeepBuild's signed release, and in the platform sandbox otherwise, after conformance and project trust; checks every call against the package's grant; fills the hub's slots; serves sources and secrets (#364) and hosted terminals (#104); runs plug-ins' model jobs through the runner and their own tests (#366); and wires composition's typed edges, with the contract tests and reopened claims a new version brings (#103). The hub opens it; the wiki reads project trust from it.

## Where new code goes

- `src/host.ts`: loading, grants, slots and installs; `src/replies.ts`: hook reply checks and joins; `src/trust.ts`: project trust.
- `src/compose.ts`: composition's rules as data (#103): matching a use to a provider by type, the first schema path that differs, serving a reading at the use's minor, cycles and dependents. The host wires, stages, tests and reopens with them.
- `src/sources.ts`: sources and secrets; `src/jobs.ts`: a plug-in's model jobs; `src/terminals.ts`: hosted terminals; `src/digest.ts`: a package folder's digest; `src/kit.ts`: the host's kit.
- The extension API schema and the sandbox side live in `runtime/`; `src/index.ts` re-exports the schema.
- Regression tests go in `test/`; acceptance tests live in `tests/acceptance/348` to `351`, `363` to `366`, `104` and `103` and are never edited.

## What it may import

Hub-side core: `@deepbuild/adapters`, `asks`, `conformance`, `contracts`, `evidence`, `leases`, `record`, `runner` (its types: the hub hands it the runner) and `supervisor`, through their public entries. It never imports an extension package, the hub, the CLI or the app; packages reach it only at run time through the host.

## Deviations

- `runtime`: plain `.mjs` with only Node's built-in modules, shared by the hub and the sandbox runner, so a sandboxed package needs to read nothing but this folder and Node.
- `kit/decision-kinds`: a planted package that tries to append decisions itself, which the host must refuse; its manifest's zero digest is a placeholder `src/kit.ts` replaces on its copy.
