# Acceptance tests for #3428: DeepBuild's paseo plugin loads on the paseo you run, or setup and the doctor say why not

Written blind, from the issue, the design and base commit `d303e2b649c275e6ae96e71ad28648bc5681536f` (origin/main,
November 27, 2026). Never edit these; a dispute goes to this job's blind redraft (design: Dogfooding).

What this job read: issue #3428 (its bullets, Scope, five criteria, Proof, References; no comments) as of November
27, 2026, and the words it cites in #55, #147, #1519, #1582 and #6; in the design, "What each agent gives us, and the
limits we design around" (the paseo row), "Hooks are evidence, not a state machine" (Health reads the agent's side,
Facts as data) and "How we know version 0 works" (Dogfooding); `AGENTS.md`; the suites `tests/acceptance/55`
(README, `helpers.ts`, `real.test.ts`, `env.ts`, `twins.json`), `3429` (README, `real.test.ts`, `twins/`) and
`27/helpers.ts` for the worlds and the house format, and `48/README.md` with `criterionId` in
`scripts/proof-change.mjs` for the IDs; at base, `packages/hub/src/setup.ts` (paseo's install, its lines, `--undo`),
`setup-steps.ts` and `contracts/setup-steps.json`, `doctor.ts` (items, codes, levels), `session-flags.ts` (how the
Agents page of #147 reads the doctor's items, `agent.reach`), `core.ts` at the reading for a version the facts don't
cover, `adapter-facts.ts`, `service.ts` (`startHub`), `packages/paseo/` (`paseo-plugin.json`, `package.json`),
`adapters/paseo.facts.json`, the listing of `adapters/corpus/paseo/`, `packages/contracts/schemas/doctor.item@1.json`
and how `packages/cli` runs `deep doctor`; and paseo itself: `npm view @getpaseo/cli` (0.17.5 on Nov 26, 0.17.6 on
Nov 27 2026, `latest`), and the 0.17.6 packages installed in a scratch folder: `@getpaseo/cli`'s `plugin` and
`daemon status` commands and its JSON output, `@getpaseo/protocol`'s `plugin-requirements.js` and the plugin list
schema in `messages.js`, and `@getpaseo/server`'s `plugins/index.js` (install, load, `config.json`'s `plugins`) and
`managed-source/npm.js`. The real 0.17.6 CLI was run for `-v`, `version`, `daemon status --json`, `plugin ls --json`
and `--help` in a scratch home; no 0.17.6 daemon was started.

## Run

```sh
npm ci && npm run build --workspaces        # setup, the doctor and the hub the tests run are the built ones
cargo build --locked -q -p deep-hook        # the hub refuses to start without it
sh scripts/lease nice -n 10 node node_modules/vitest/vitest.mjs run --root tests/acceptance/3428 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/3428/tsconfig.json
```

- Node 24 (type stripping on), on macOS. Every file but `real.test.ts`'s daemon half runs on any machine, with no
  paseo installed: its paseo is the stand-in.
- **AC1's daemon half** needs a real paseo of the newest stable release: `npm i --prefix <dir> @getpaseo/cli@0.17.6`
  (no account), then `DEEP_PASEO_CLI=<dir>/node_modules/.bin/paseo` on the command above. It then runs #55's own
  `tests/acceptance/55/real.test.ts` with that variable, which starts a real daemon in a scratch home as #55's README
  says (#55's `fixtures/fake-provider`, a free port on 127.0.0.1, relay off). Missing, not a stable release, older
  than 0.17.6, or another version than the facts' newest, it reads `BLOCKED`, never PASS and never a skip.
- Homes are #27's: `/tmp/dh27-*/h` is HOME for every process, `/tmp/dh27-*/bin` comes first on PATH with #27's
  stand-ins for `launchctl`, `systemctl` and `claude`, a `deep` that runs the built CLI, and the stand-in `paseo`. The
  real `~/.deepbuild`, `~/.paseo`, `~/.claude` and `~/.npmrc` are never touched. The local npm registry listens on
  127.0.0.1; nothing reaches past it. Processes are stopped by PID (#27's cleanup), never by name or port.
- `lane.json` runs the folder alone, as #55 and #3429 run: each test starts a hub, and AC1 a real daemon. With
  `--root` here Vitest may write `tests/acceptance/3428/node_modules/.vite`; delete it before committing.
- `DEEP_HUB_PLANT=<name>` set by hand reaches setup, the doctor and the hub through #27's `childEnv`, to try a
  wrong program (`twins/README.md`).

## The worlds

Everything this repo owns runs for real: `deep setup`, `deep setup --undo`, `deep doctor --json`, the hub (`deep hub
run`, started as #27's tests start it, so setup reports its steps and prints its one line), the facts and the
plugin's files. What it doesn't own is a stand-in:

- **The stand-in `paseo`** (`fixtures/paseo.mjs`, on PATH as `<tmp>/bin/paseo`): paseo's CLI and its running daemon
  in one process per command, at the version the test plants, owning `~/.paseo/config.json` as paseo does. It
  speaks the shapes of @getpaseo/cli 0.17.6 as read from its package: `paseo -v` and `--version` print the version
  (there is no `paseo version`, as in 0.17.6); `paseo status` and `paseo daemon status --json` give `localDaemon:
  running` and `daemonVersion`; `paseo plugin ls --json` is an array of plugin list items (`id`, `path`, `enabled`,
  `status` one of `running`, `disabled`, `failed`, `error` when failed, `npm` and `installation` for an npm install);
  `paseo plugin install|add <source>` takes a folder or an `npm:` source; `remove`, `enable`, `disable` and `reload`
  take an ID; errors are `Error: <message>` on stderr (`{"error": …}` with `--json`), exit 1. It computes a plugin's
  state as paseo's daemon does at load: plugins on, the entry enabled, and the plugin's `requirements.paseo` holding
  the daemon's version, else `failed` with paseo's own words (`Plugin "deepbuild" requires Paseo <range>. Your daemon
  is <version>. Use a compatible plugin version or update the daemon.`, plugin-requirements.ts at 0.17.6, through
  `range.ts`). An install checks the range before it writes anything, refuses an ID already configured, and then
  writes config.json as paseo does, `JSON.stringify(…, null, 2)`. An `npm:` source is read from npm's configured
  registry (`npm_config_registry`, else `registry=` in `~/.npmrc`), as paseo's daemon reads it through npm; a 404
  there is npm's `E404`. It appends every command it is run with, its words without options, to
  `<tmp>/paseo-state/calls.jsonl` before it runs it.
- **paseo's `config.json`**, planted in a form paseo never writes (four spaces, objects on one line), so any write of
  paseo's shows in its bytes; the tests compare it byte for byte.
- **The plugin as installed**: a copy of `packages/paseo` as it stands (`installed`), or an old copy of it whose
  `requirements.paseo` is `>=0.14.0 <0.15.0`, older than any paseo the facts have covered (`old copy`), placed where
  paseo keeps an npm install and entered in config.json as one from the facts' source.
- **npm's registry** (`world.ts`, as #55's `registry()`): on 127.0.0.1, serving the facts' `install.source` (its name
  at its version, the tarball of the plugin as installed), or answering 404 for it. Its URL is in the environment of
  every command a test runs and in the test's `~/.npmrc`.

## Criteria to tests

IDs are the first 8 hex of SHA-256 of each criterion's text, trimmed, whitespace collapsed.

| Tag | Criterion | Test | What it plants and requires | Wrong program it fails on |
|---|---|---|---|---|
| `#3428.c21bc24c` | #55's real-daemon cases pass on the newest stable paseo, and the facts and the plugin's range name that release. Until they do, the criteria below that need a covered release read BLOCKED, never PASS | `real.test.ts`: `the facts' newest version is paseo's newest stable release …` | The facts' `versions` end at 0.17.6 (or the newer stable paseo given); the plugin's `requirements.paseo` holds it and every version the facts cover | `range-left-at-0.16` (planted), the merge base |
| `#3428.c21bc24c` | (the same) | `real.test.ts`: `#55's real-daemon cases … pass on a real daemon of that release` | With `DEEP_PASEO_CLI` a real paseo ≥ 0.17.6 that the facts and the range name: #55's `real.test.ts` run unchanged, its three daemon cases (AC1's turn end, AC5's tools, AC7's removal) each passed. #55's phone half needs a paired phone and reads BLOCKED in #55's own suite; it is no daemon case. A daemon case that reads BLOCKED makes this BLOCKED | `facts-ahead-of-run` |
| `#3428.ffe37f29` | With a paseo newer than the facts on the PATH, `deep setup` runs no `paseo plugin install`, leaves paseo's `config.json` byte-equal, and its line names paseo's version and the versions covered. The merge base runs the install and prints the daemon line, and fails this test, naming that line | `setup.test.ts`: `paseo one minor past the facts' newest …` | paseo at the facts' newest minor plus one, no plugin, the source served: no `paseo plugin install` and no command that changes paseo, config.json byte-equal, and one line naming paseo, its version and the newest and oldest versions covered | `installs-any-version` (the merge base), `says-no-versions` |
| `#3428.ffe37f29`, `#3428.53c885f5` | the other side of both lines | `setup.test.ts`: `the other side of the line …` | paseo at the facts' newest, no plugin, the source served: one `paseo plugin install` of the facts' source, and paseo holds `deepbuild`. Then BLOCKED until a covered release (AC1) | `refuses-every-version` |
| `#3428.25c11692` | With the plugin listed in paseo and refused at load, `deep setup` doesn't report paseo as set up, and `deep doctor` shows the plugin's item at its error level with paseo's reason. The merge base's setup returns with no line and fails, naming the plugin's state | `setup.test.ts`: `paseo lists deepbuild, failed at load …` | paseo at the facts' newest, the old copy installed and refused (the registry serves the old copy too, so a reinstall lands it again): setup's one line doesn't list paseo, the record holds no `setup.step` for paseo, and setup says paseo's reason (Scope) | `listed-is-set-up` (the merge base) |
| `#3428.25c11692` | (the same) | `doctor.test.ts`: `paseo lists deepbuild failed at load …` | The same world, no setup: a paseo item whose name says `plugin`, at level `fail`, whose evidence holds paseo's reason, its code one of the doctor family's and not `healthy` | `plugin-item-warns`, `reason-dropped`, the merge base |
| `#3428.cfb1bd37` | On a covered paseo with the plugin loaded, every paseo item reads ok. With no paseo on the PATH there is no paseo item | `doctor.test.ts`: `paseo at the facts' newest, the plugin installed …` | paseo at the facts' newest, the plugin installed from the facts' source and running, the source served, `deep setup` run: paseo items naming the version, the plugin and the source, every one at level `ok`, each with a code of the doctor family. Then BLOCKED until a covered release | `source-from-npmjs`, the merge base |
| `#3428.cfb1bd37` | (the same) | `doctor.test.ts`: `with no paseo on the PATH …` | The stand-in removed and PATH cut to `<tmp>/bin`, Node's folder and the system's, `~/.paseo` left in place: no paseo item. Then BLOCKED until a covered release | `items-without-paseo` |
| `#3428.53c885f5` | A source that answers 404 is named before paseo's `config.json` is written, and `deep setup --undo` afterwards changes nothing. A setup that edits the file first fails, naming the file | `source.test.ts` | paseo at the facts' newest, no plugin, the registry answering 404: no `paseo plugin install` and no command that changes paseo, config.json byte-equal, the registry asked for the package, and a line naming the source as answering 404 (or not resolving); then `deep setup --undo` exits 0, runs no paseo command that changes it, and config.json stays byte-equal | `edits-config-first` (the merge base), `source-unnamed`, `undo-removes-anyway` |

Each failing assertion's message holds what its criterion names: the daemon line setup printed (AC2), the plugin's
state as paseo lists it (AC3), the file (AC5). `twins.json` maps each tag to its twins; `twins/README.md` says how
each is planted.

## Surfaces chosen where the issue leaves them open

- **paseo's version** is what the stand-in reports everywhere paseo reports one: `paseo -v`, `paseo --version`, and
  `daemonVersion` in `paseo status` / `paseo daemon status --json`. The tests don't say which one setup and the
  doctor read.
- **"The plugin as installed" and "refused at load"** are `paseo plugin ls --json`'s item `deepbuild` with `status`
  `running`, or `failed` with its `error`. "paseo's reason" is that `error`, matched by its words `requires Paseo
  >=0.14.0 <0.15.0`.
- **paseo's items** are `deep doctor --json`'s items whose `agent` is `paseo`, as Claude Code's are `claude-code`'s.
  Their names are the implementer's; the tests find the plugin's item by `plugin` in its name, the version's by the
  version in its evidence, and the source's by the package's name in its evidence. "A stable code" is one of the
  codes the doctor family's schema lists (`packages/contracts/schemas/doctor.item@*.json`), so a new code is added
  there; "its error level" is `fail`; "reads ok" is level `ok`. Suggested names, not asserted: `paseo.binary`,
  `paseo.plugin`, `paseo.source`.
- **"Its line"** (AC2) is any one line of `deep setup`'s output, stdout or stderr, that names paseo, the version
  running, and the newest and the oldest versions the facts cover; a span (`0.15.0 to 0.17.6`) or a list both read.
- **"Report paseo as set up"** (AC3) is setup's one line (#1455's `DeepBuild's hooks are in … settings`) listing
  paseo, or a `setup.step` event for paseo in the record (#1100). Setup's exit code isn't asserted.
- **"A source that answers 404"** is npm's configured registry answering 404 for the facts' package: the registry
  paseo's own npm would ask. A check that asks registry.npmjs.org whatever npm is configured with reads no 404 here
  (no network) and fails the test. "Named" is a line holding the source (or the package's name) and `404`, `not
  found` or `doesn't resolve`. "Is named before config.json is written" is read with the Scope ("paseo's
  configuration isn't touched"): no write at all, so no paseo command that changes it runs, and the bytes stay.
- **"deep setup --undo afterwards changes nothing"**: it exits 0, runs no paseo command that changes paseo, and
  config.json keeps its bytes. Its mtime isn't asserted.
- **"A covered release"** (AC1's second sentence) is the facts' newest version being 0.17.6 or later with the range
  holding it. The criteria that need one are AC4 (its world is "a covered paseo") and the covered side of AC2's
  and AC5's lines; their tests call `needCoveredRelease` once their own assertions hold, as #3429's call `needRun`.
  AC2, AC3 and AC5 don't need one and never read BLOCKED for it.
- **The newest stable paseo** is 0.17.6, npm's `latest` on November 27 2026, unless a newer stable paseo is given
  through `DEEP_PASEO_CLI`; no test reads the network to learn a newer one. When paseo ships 0.17.7, this constant
  is stale until a redraft or a run given 0.17.7.

## Open questions

1. **The criterion's "#55's real-daemon cases"** include #55's phone half, which reads BLOCKED in #55's own suite
   for want of a paired phone. This suite counts the three daemon cases and leaves the phone half to #55, #65 and
   #146. If the owner wants the phone half too, AC1 reads BLOCKED until a phone is paired.
2. **The plugin's range "holds exactly those versions"** (Scope). Not asserted: exactly would need every paseo
   release between, which no test here can list. The tests assert the range holds the newest and every version the
   facts cover.
3. **AC3's setup and a refused plugin.** Read as: setup leaves the plugin where paseo has it and says why it isn't set
   up. A setup that removes your plugin and reinstalls it isn't asked for; in this world a reinstall lands the same
   old copy, so it still reads refused.
4. **The Agents page (#147).** The Scope says paseo's items show there with every other agent's; no criterion names
   it, and the base's page reads only `hookItems` for agents with hooks (`session-flags.ts`, `agent.reach`). Not
   asserted.
5. **The doctor's source item without a registry.** With no `npm_config_registry` and no `~/.npmrc`, npm asks
   registry.npmjs.org; the tests always give a registry, so what the item reads offline isn't asserted.

## How far these tests were checked

Run, on the base:

- **The whole suite, once, on the built base** (`BASE-FAILURE.txt`), through `scripts/lease` after a build grant
  came at the third try (the first two waited 30 and 90 minutes at a load of about 100 to 170 on 18 cores and got
  none). The lease found no hub of the user's to lease a CPU slot from, so the run held the throttle's grant alone.
  15 s for the nine tests. Six fail at an assertion of this suite's, each naming what its criterion asks:
  - `#3428.c21bc24c`, the facts and the range: "versions end at paseo's newest stable release 0.17.6; they are
    0.15.0".
  - `#3428.ffe37f29`: "paseo 0.16.0 runs … deep setup must run no paseo plugin install; it ran paseo plugin ls
    --json; paseo plugin install npm:@deepbuild/paseo@0.1.0", quoting setup's lines down to "Run deep setup again once
    paseo's daemon runs." (the stand-in refused the install with paseo's own words, as 0.17.4 does in the issue).
  - `#3428.25c11692`, setup: "paseo 0.15.0 lists deepbuild with status failed: Plugin "deepbuild" requires Paseo
    >=0.14.0 <0.15.0 … deep setup must not report paseo as set up", quoting the line "DeepBuild's hooks are in
    Claude Code's and paseo's settings …". The base's paseo step returned with no line of its own.
  - `#3428.25c11692`, the doctor: "deep doctor has an item for the plugin, its agent paseo; paseo's items: []".
  - `#3428.cfb1bd37`, covered paseo: "deep doctor shows paseo's items … paseo's items: []".
  - `#3428.53c885f5`: "npm:@deepbuild/paseo@0.1.0 answers 404 … deep setup handed paseo's ~/.paseo/config.json to
    paseo plugin install before checking the source", quoting npm's E404 as the stand-in gave it back.

  Three read BLOCKED. The covered side of AC2's and AC5's lines (setup ran one `paseo plugin install` of the facts'
  source and paseo held `deepbuild`) and AC4's no-paseo half (no paseo item) held their assertions on the base and
  stopped at the missing covered release. AC1's daemon half, given a real paseo 0.17.6 through `DEEP_PASEO_CLI`,
  stopped because the facts name 0.15.0; #55's `real.test.ts` was not started.
- **The stand-in by hand** (a scratch script, before the suite): `-v`, `daemon status --json`, `plugin ls --json`, a
  folder install refused on 0.17.6 and taken on 0.15.0 for the base's plugin with paseo's words, the same plugin
  listed `failed` once the version moved to 0.17.6, an `npm:` install with no registry configured, `remove`, and an
  unknown command, each logged to `calls.jsonl`.
- **The real paseo 0.17.6 CLI** (scratch home, no daemon): `-v` and `--version` print `0.17.6`, `paseo version` is an
  unknown command, `daemon status --json` gives the fields the stand-in gives with the daemon stopped, and `plugin ls
  --json` with no daemon is `{"error": {"code": "DAEMON_NOT_RUNNING", …}}` on stderr, exit 1.
- `tsc -p tests/acceptance/3428/tsconfig.json` exits 0.

Never run:

- **Any implementation or twin.** None exists. So no test has been seen to pass, none to fail on a twin but the base,
  and every assertion after each failing test's first has never been evaluated: AC2's config bytes and its line,
  AC3's record and reason in setup, AC3's level, reason and code in the doctor, AC4's levels and codes, AC5's bytes,
  registry ask, named source and the whole undo half. `range-left-at-0.16` (planted) was not laid over anything.
- **#55's real-daemon cases on paseo 0.17.6.** AC1's daemon half has only been seen to read BLOCKED. Whether #55's
  `real.test.ts` run as a child of this suite (vitest's JSON reporter, its `assertionResults` titles) parses as
  written is unchecked; the phone half is told apart by its title, "an ask shows in paseo's phone app".
- **The stand-in against a real 0.17.6 daemon.** Its shapes are read from 0.17.6's packages, not compared with a
  running daemon's output; in particular what a real daemon lists for an npm install (`npm`, `installation`) and
  the exact load-time error of a plugin it refuses after an update were not observed.
- **The lanes.** `scripts/affected.mjs`, `scripts/proof.mjs`, `scripts/lanes.mjs` and the preflight were not run, by
  this job's brief.
