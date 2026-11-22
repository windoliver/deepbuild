# Acceptance tests for #1828: the hub hands its asks core to the extension host

On a real hub, a plug-in path that needs your yes asks you instead of refusing: a send with no standing rule, a
release package's resolver, and an update that drops an interface an installed package uses.

Written first and blind, at base commit `2eaaeb0e6693410db653a43377ec32dde1cc63ab` (origin/main, 2026-11-22), by a
job that saw no implementation of #1828, no other branch, worktree, pull request, stash or session notes. The
implementing agent does not edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding).

## Sources

- **The issue**, #1828, as given to this job: its text, Scope, three criteria and Proof. The issues it depends on
  (#23, #348, #365) were not read.
- **The design**, `docs/technical-design.md`: Blocks for plug-ins that do real work (Sends, Channel), the Asks
  sections the resolver gate follows, the Extension host, How we know version 0 works (Wrong programs, Dogfooding,
  Tests written first). `AGENTS.md`.
- **The base, for surfaces only**: `packages/hub/src/{core,server,plant,trusted-actions,human-answers,install}.ts`,
  `packages/extension-host/src/{host,sends,host-shared}.ts`, `packages/extension-host/runtime/deep.mjs`,
  `packages/asks/src/{index,resolver-gate,decision-keys}.ts`, `packages/asks/sources.json`,
  `packages/resolver-decisions/src/index.ts`, `packages/contracts/src/manifest.ts`, and the suites `2402`, `2648`,
  `27`, `29`, `103` and `365` for their conventions. #27's world (`../27/helpers.ts`) and #29's verdict helpers
  (`../29/h-d.ts`) are imported unchanged; #2402's install with no hub running is adapted in `helpers.ts`.

## How to run

From the repo root, after `npm ci`, `npm run build --workspaces` and `cargo build --locked -p deep-hook`:

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run tests/acceptance/1828 --no-file-parallelism \
  --testTimeout=600000 --hookTimeout=180000 --reporter=verbose
npx tsc -p tests/acceptance/1828 --noEmit
```

- **Needs**: Node 24.22 or newer, `packages/cli/dist/main.js`, `target/debug/deep-hook`, `git` and `openssl` (the
  stand-in's certificate). Each missing one is BLOCKED, never a pass (`built()`).
- **Time**: about a minute for the suite at a low load; each file starts its own hub.
- **Safety**: each home is under `/tmp/dh27-*` (#27's temp folders, removed afterwards) with its own `HOME`, the
  stand-ins for `launchctl`, `systemctl` and `claude` first on its `PATH`, and the OS confirmation stubbed
  (`DEEP_HUB_TEST_CONFIRM`). Nothing reads or writes the real `~/.deepbuild` or `~/.claude`. No network, no model:
  the send goes to an HTTPS server on 127.0.0.1 that this suite starts. Every process is stopped by its PID.
- **Lanes**: every file starts a real hub (`alone`).

## The surfaces under test

All are named by the issue or merged at the base:

- **The hub**: `deep hub run`; the record through its socket's `events.read` (`ask.created`, `ask.answered`,
  `ask.defaulted`, `ask.batched`, `decision.created`, `decision.applied`); `deep setup`; `deep inbox answer <ask>
  <option>` (your answer on the trusted path); `deep install <folder>` (an update from your own terminal); deep_ask
  from a session's own `deep mcp` (#27's asking session).
- **Test settings merged at the base**: `DEEP_HUB_TEST_RELEASE` (#2402: release entries the hub's host loads in the
  hub), `DEEP_HUB_TEST_CONFIRM`, `DEEP_HUB_PLANT` (the base refuses a name it doesn't list).
- **The extension API** as the base has it: `deep.send` (a send through a host the grant names, `https://<host><path>`),
  `deep.registerResolver`, `deep.provide`, `deep.use`; manifests held to `extension.manifest@1`.
- **The extension host's files**: `<hub root>/extensions/installed.json`, read for which version of a package is
  installed; the packages are installed before the hub starts through the host's public entry (`openExtensionHost`,
  `install`, `check`), as #2402 installs them, since a grant naming a send's host can't be given by `deep install`.
- **Node's own `NODE_EXTRA_CA_CERTS`**, handed to the hub so its HTTPS client trusts the local stand-in's certificate.

### Choices: names the implementation has to provide

1. **The planted hub `host-without-asks`** (AC1's wrong program), listed in `packages/hub/src/plant.ts` and chosen
   with `DEEP_HUB_PLANT`: the hub opens its asks core and then the extension host without it, as the base does;
   everything else as shipped. A hub that refuses the name (the base does) is BLOCKED, never a pass.

## The packages

Each is a TypeScript package written by no agent, listed in the hub's release file so it loads in the hub's process,
and each appends what it did to its own log file under the test's temp folder, with its process ID.

- **acme/notify** (AC1): access word `hosts`, a grant naming the stand-in's `127.0.0.1:<port>`. Once a trigger file
  appears it makes that one send with `deep.send`, outside any action or schedule (an email to
  `you@example.invalid`, a fresh key), and notes `sent` or `refused` with the host's words. No standing rule covers it.
- **acme/answers** (AC2): registers one resolver with `deep.registerResolver`, noting `registered` or
  `register_refused`. Asked about an ask, it reads its rule file `{ key, answer, decision }` and answers an ask of
  that key with that option, naming that decision; it notes every consultation.
- **acme/feed 1.0.0** provides `ext.feed.level@1`; **acme/board** uses it; **acme/feed 2.0.0** provides only
  `ext.feed.level@2` and keeps no adapter for `@1` (AC3).

## Criteria to tests

| Criterion | Test | Reading |
|---|---|---|
| AC1 `#1828.65fe62dd`, right program | `send.test.ts` | Exactly one ask names the send's key, with action.send's options (approve allows, decline denies); the stand-in got nothing before your yes, and exactly one request carrying the key after it. |
| AC1, wrong program | `planted.test.ts` | The same scene and judge on `DEEP_HUB_PLANT=host-without-asks` must fail, the failure naming `` `deep.send` ``. |
| AC2 `#1828.6794e119` | `resolver.test.ts` | acme/answers registers in the hub; asked about session B's repeated question, it answers green naming the decision your answer to A saved, before B's ask closes; B's ask closes with `decision.applied` citing that decision; no `ask.batched` ever names B's ask. |
| AC3 `#1828.44a54c78` | `update.test.ts` | `deep install` of acme/feed 2.0.0 raises one authority ask naming acme/feed 2.0.0 and acme/board; for 5 s unanswered, installed.json still names 1.0.0 and the install still waits; on `deep inbox answer … approve` the install exits 0 and installed.json names 2.0.0. |

Expected on the base (Proof): each case fails with the host's "no asks core" refusal, and the planted hub is BLOCKED
(the base lists no such plant). See `BASE-FAILURE.txt`.

## Limits

- **The ask's source.** `ask.created` doesn't record the ask.sources@1 row it was raised from, and no hub read
  serves it. An ask is read as action.send's or extension.update's by the rows' shape in `packages/asks/sources.json`
  (an authority ask, approve allowing and decline denying) and by naming what it is about: the send's fresh key, or
  the update's package and version.
- **AC2's resolver and resolver-decisions.** resolver-decisions ships on by default, registered with the asks core
  directly, and answers from the same saved decision, so the ask closing as decided for you alone can't say whose
  answer counted. The test therefore also needs acme/answers's own note, from the hub's process, that the hub
  consulted it about that ask and that it answered with that decision before the ask closed. A hub that consulted it
  and dropped its answer while resolver-decisions answered would still pass; no hub surface tells the two apart.
- **AC1's deadline.** A send outside any action or schedule asks with the host's call limit (10 s) as its deadline.
  The test answers at once with `deep inbox answer`; an ask that took its default before the answer landed is
  INCONCLUSIVE (a skip that says so), never a pass and never the criterion's failure.
