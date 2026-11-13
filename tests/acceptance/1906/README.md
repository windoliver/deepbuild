# #1906 acceptance tests

Drafted blind from the issue, `docs/technical-design.md` and `AGENTS.md` at base `331b68be1`. Nobody implementing #1906
edits these files; a dispute goes to a fresh blind redraft (design: Dogfooding).

## Criterion to check

| Criterion | Check | On the base |
|---|---|---|
| AC1 `core.ts` holds one forge URL default | `sources.test.ts` › one forge URL default | fails: 13 sites |
| AC1 `core.ts` holds one `done.yaml` reader | `sources.test.ts` › one done.yaml reader | fails: 4 readers |
| AC1 `core.ts` is shorter by the folds | no test; see Open questions. Proof is the line count: `wc -l packages/hub/src/core.ts` is 8666 on the base | n/a |
| AC2 one shell quote | `sources.test.ts` › one shell quote | fails: 4 functions in `packages/hub/src` |
| AC2 one `duration` | `sources.test.ts` › one duration | fails: 3 readers in `packages/hub/src` |
| AC2 one listener probe | `sources.test.ts` › one listener probe | fails: `env-local/src/stack.ts` and `hub/src/stacks.ts` |
| AC3 the fork at `open-items.ts:57-60` | `children.test.ts` › open items | fails: `git diff` and `git ls-files` start on the calling thread |
| AC3 the fork at `scope.ts:82` | `children.test.ts` › size and scope | fails: `git log` starts on the calling thread |
| AC4 no visible change | the existing suites below, unchanged, through `node scripts/affected.mjs` | must pass |
| AC4 each package's type-check passes | the repo's typecheck lane, through `node scripts/affected.mjs` | must pass |

`children.test.ts` › "the watch tells the two apart" is a guard and passes on the base: it shows the instrument sees a
child this thread forks and does not see one `children.ts` runs.

## How the checks read

- **Copies are found by what they do, not by name.** A shell quote is a function whose whole result is its argument
  between single quotes with each `'` written `'\''`; a duration reader is a pattern of a whole number and a unit
  letter with `m`, `h` and `d` among the units; a listener probe is `lsof` asked for `-sTCP:LISTEN`. Each test wants at
  most one place in the hub's sources and at least one in some package, so the owner may be the hub's or a package
  the hub imports.
- **The children test stands on the core thread.** It loads `packages/hub/dist/{children,open-items,scope}.js` (build
  first: `npm run build --workspaces`; a missing build reads BLOCKED), runs real `git` in a temporary repository, and
  lists the children Node announces on the calling thread (`child_process` diagnostics channel). Each test also reads
  the module's answer, so a module that stops running git fails too.

## Existing coverage reused for AC4 (not duplicated here)

- Open items: `tests/acceptance/323/`, `tests/acceptance/82/`, `tests/acceptance/87/`
- Size and scope: `tests/acceptance/324/`, `packages/hub/test/size-scope.test.ts`, `packages/hub/test/scope.test.ts`
- The children's thread: `packages/hub/test/start-ps.test.ts`, `packages/hub/test/hook-parent.test.ts`, `packages/hub/test/background-group.test.ts`
- Forge and `done.yaml` paths in `core.ts`: `packages/hub/test/forge.test.ts`, `packages/hub/test/github-source.test.ts`, `packages/hub/test/gate-runner.test.ts`, `packages/hub/test/landing-gate.test.ts`
- Shell quote callers: `packages/hub/test/hosts.test.ts`, `packages/hub/test/install.test.ts`, `packages/hub/test/codex-files.test.ts`, `packages/hub/test/acceptance-slots.test.ts`
- Duration callers: `packages/hub/test/staging.test.ts`, `packages/asks/test/`
- Listener probe: `packages/env-local/src/index.test.ts`, `packages/hub/test/stack-provider.test.ts`, `packages/hub/test/leftover.test.ts`
- Extension host folds: the suites under `packages/extension-host/`

`node scripts/affected.mjs` picks the ones a change reaches; its known failures (`scripts/known-failures.json`) and any
BLOCKED line stay as they are.

## Open questions (no check drafted)

1. **`alive` on `EPERM`.** The issue says it will name the right answer before the fold and does not. No test asserts
   either answer.
2. **"Shorter by the folds".** The issue gives "about 60 lines" and no number to hold. A test pinned to the base's
   8666 lines would fail on any later growth of `core.ts`, and one against the merge base fails once merged. The
   line counts before and after are the proof, as the issue's Proof line says.
3. **Which four files hold the shell quote.** The base has four quote functions in `packages/hub/src`
   (`acceptance.ts`, `codex-settings.ts`, `setup.ts`, `hosts.ts`), one exported from `env-local/src/stack.ts`, and
   inline quotes in `heavy.ts`, `core.ts` (two) and `claude-settings.ts`. The test counts functions in
   `packages/hub/src` only; whether the inline ones and env-local's fold is not asserted.
4. **Which `duration` owns.** `packages/asks` exports one that reads `m`, `h`, `d`; `channels.ts` also reads `s`. The
   test allows either owner.
5. **Other core-thread forks.** `usual` also forks git on the calling thread through `@deepbuild/gate`'s `measure`,
   and many hub modules call `node:child_process` directly. The issue names two forks, so only those are asserted.
6. **`isObj`, write-then-rename, `keyOf`, `appendSession`, `this.raw`, the `this.answers` forwarders, and the
   extension host's folds** have no acceptance criterion of their own beyond AC4.
