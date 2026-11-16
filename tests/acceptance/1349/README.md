# Acceptance tests for #1349: starting from nothing, a person with no agent and no developer tools gets from the download to a first result

Written first and blind, at `21eb8748d` ("Design: starting from nothing (#1349)", on `0e5572731`), from issue #1349's
body (Scope, eight acceptance criteria, Proof, Depends on), the design and the base, before any implementation. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

## What was read

- **The issue**, #1349, its body only.
- **The design**, `docs/technical-design.md` at `21eb8748d`: How it installs (Setup; Starting from nothing (#1349), all
  five bullets), Sign-in is one task per agent (`#sign-in`), Plan usage's Turns DeepBuild causes (the first-reading
  gate and its new #1349 sentence), Platforms, Work outside a repo, and Dogfooding. `AGENTS.md`.
- **The base**, for surfaces only: `crates/deep-app/src/setup.rs`, `words.rs` (the box sends `box.say`) and `hub.rs`
  (`call_app`); `crates/deep-replica/src/drive/mod.rs` (launch options, `act`); `contracts/setup-steps.json`;
  `packages/hub/src/server.ts` (roles), `plant.ts`, `keychain.ts` (`DEEP_HUB_TEST_KEYCHAIN`), `workspace-command.ts`;
  `packages/runner/src/runner.ts`, `agents.ts` and `egress.ts` (a job's sandbox grant, its forwarder and its upstream
  proxy, how an API error names a stop's cause); `adapters/claude-code.facts.json` (`signIn`, the stop causes),
  `adapters/sign-in.json`; the schemas `ask.created@5`, `ask.moot@2`, `setup.step@1`; `packages/record` (the
  `events` table); `scripts/release-pack.mjs`, `scripts/app-bundle`, `scripts/proof-change.mjs` (`criterionId`).
- **Suites**, as models: `1100` (imported: its screen readers, `controlFailures` and `fixtures/launcher.mjs`), `1342`
  (its research-job answer and card contract, followed here), `19/status` (imported: `sweep`, `everyForm`, `walk`),
  `41`, `1328`, `63`, `1426/added-real/real-judge.mjs`.

No branch, worktree, pull request or session working on #1349 was read.

## Criterion to tests

Each test's name starts `AC<n> #1349.<8 hex>`: SHA-256 of the criterion's text, trimmed, white space collapsed, as
`scripts/proof-change.mjs` computes it. A test marked `(wrong program)` runs a planted program and expects the
criterion's own judge to fail on it, naming what the criterion says.

| AC | ID | Criterion, in short | Tests | Wrong programs it fails on |
| --- | --- | --- | --- | --- |
| AC1 | `#1349.ba1a9b5f` | clean account: download to the box, no terminal, no developer tools prompt; sign-in in the agent's own window | `clean-account.test.ts` AC1 (the recorded run, else INCONCLUSIVE); `journey.test.ts` AC1 (fixture: the box ready after Set up, and not one call to the refusing `git`, `xcrun`, `cc` or `node`) | the base (no runtime folder: BLOCKED); a Set up that runs a system `node` or `git` (logged by the stand-ins) |
| AC2 | `#1349.30081c64` | a topic makes a workspace with history and going back; a build needing a system git fails, naming the call | `journey.test.ts` AC2 (card approved, `workspace.created`, history on `main` read and a kept change reverted with `deep workspace revert`, all on the shipped git); `plants.test.ts` AC2 | `--plant system-git` (no `git/` in the runtime): its first git call reaches the refusing stand-in, and what DeepBuild shows names `git <subcommand>` |
| AC3 | `#1349.d6911e12` | record and logs hold no credential; a scan finds none | `journey.test.ts` AC3: every file under `~/.deepbuild` but `versions/`, searched for the installer's, the probe's, the sign-in command's and the Keychain's canaries in every form (#19's `everyForm`) and for anything credential-shaped | the scan's own check: the token planted base64-encoded in a log is named |
| AC4 | `#1349.e08d3218` | a planted lapsed sign-in pauses the work with one plain line; it resumes after sign-in, nothing lost | `journey.test.ts` AC4: the sign-in lapses while a second topic's job is at the model; one open sign-in task, its question one plain line; no card while lapsed; after signing in, the task closes, the card comes with your words, the first workspace's history is all there | the base (no sign-in task) |
| AC5 | `#1349.7e8a2760` | the app's part, installer and sign-in left out, under 2 minutes | `journey.test.ts` AC5: Set up press to the box ready, minus the stand-in installer's logged time, at most 120 s; past it under a 1-minute load at or above the core count, INCONCLUSIVE (a skip) | the base (BLOCKED) |
| AC6 | `#1349.aa369523` | a person signs in once from the row's button in a recorded run; words typed before sign-in reach the agent once; a hub closing the row when the page returns fails, naming the check | `clean-account.test.ts` AC6 (the recorded run, else INCONCLUSIVE); `journey.test.ts` AC6 (fixture); `plants.test.ts` AC6 | `closes-on-return`, naming `ask:<id>`, `claude auth status` and `not signed in` |
| AC7 | `#1349.72be1f28` | one button with no agent found; a planted install button beside Set up fails, naming the control | `first-screen.test.ts` AC7 (#1100's `controlFailures`) | `install-button-beside-set-up`, naming `button … "Install …"` |
| AC8 | `#1349.8524225c` | setup's events name the agent the first screen's row named; a setup installing another agent fails, naming both | `first-screen.test.ts` AC8 (the screen's half); `journey.test.ts` AC8 (the record's half); `plants.test.ts` AC8 | `installs-other-agent`, naming `Claude Code` and `Codex` |

## How to run

macOS (the replica draws there only), Node 24.22 or newer, cargo on `PATH`, outside the Bash tool's sandbox, with the
checkout committed (the release pack refuses a changed tree):

```sh
npm ci && npm run build --workspaces
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:/opt/homebrew/opt/rustup/bin:$PATH"
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-replica --bin deep-drive
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-replica --bin deep-drive --features env-plants
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1349 --no-file-parallelism --testTimeout=600000 --hookTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1349/tsconfig.json
```

- **Builds, once per commit.** The first test that needs the runtime folder makes the release's archives
  (`node scripts/release-pack.mjs --repo <checkout> --commit HEAD --out target/da1349/<commit>/archives`) and then
  `node scripts/app-runtime.mjs --archives … --out target/da1349/<commit>/runtime` (and `runtime-system-git` with
  `--plant system-git`), and marks each done; later runs on the same commit reuse them. It compiles git and fetches
  Node, so the first run is slow. A build that fails is BLOCKED, naming the command and its output, never a pass. The
  helpers run the two `deep-drive` builds too (a no-op when current) and copy each into `target/da1349/bin/`.
- **Folders and processes.** Each world lives under `/tmp/da1349-*`, HOME `<tmp>/h`, removed at the end. Children get
  none of this process's `DEEP_*`, `CLAUDE*`, `CODEX*`, `XDG_*`, `GIT_*`, `GH_*`, proxy or billing variables. Only
  processes a world started are stopped, by PID: the suite's children, the hubs the login service stand-in logged,
  their descendants, and processes whose command line names the world's folder. Nothing touches the real `~/.deepbuild`,
  `~/.claude`, `~/.local` or login Keychain (`DEEP_HUB_TEST_KEYCHAIN` stands in for it; the hub never reads the real
  one under a temp HOME).
- **No model, no network.** The stand-in `claude` reaches the test's model server only, through the runner's own
  forwarder. Nothing leaves 127.0.0.1.
- **Lanes.** Every file starts real setups and hubs: `tests/acceptance/1349/` belongs on `scripts/lanes.mjs`'s `alone`
  list, in a macOS, logged-in lane. The implementer makes that edit.
- **`--root` cache.** Vitest writes `tests/acceptance/1349/node_modules/.vite/`; it is ignored by git.

## The fixture machine

`helpers.ts` `openWorld`: a temp home with nothing on it. `<tmp>/sys` is first on the system PATH, before
`/usr/bin:/bin:/usr/sbin:/sbin`, and holds:

- **the refusing stand-ins**, `git`, `xcrun` and `cc` (each logs its call to `<tmp>/refused.log`, prints macOS's "No
  developer tools were found, requesting install." and exits 1, as the shims on a clean Mac pop the prompt) and `node`
  (logs, "command not found", 127, as a clean Mac has none). On the right program the log stays empty for the whole
  journey. They shadow `/usr/bin/git` and `/usr/bin/xcrun` for every lookup by PATH; a call by absolute path is what the
  clean account's run catches.
- `sh-login`, the login shell (`SHELL`), whose PATH is `<tmp>/sys` and the system folders: no `claude`, `codex`, `node`
  or `git` but the refusing ones.
- `launchctl`, `systemctl` (log, exit 0), and `launcher`, the login service stand-in through `DEEP_HUB_LAUNCHER`
  (#1100's `fixtures/launcher.mjs`, run by this Node's own path), which gives the hub the world's test seams and
  `HTTPS_PROXY`, the model's address.

## Stand-ins

- **The agent's installer**: `<tmp>/installer.sh`, named by `DEEP_HUB_TEST_INSTALLER` (design). It logs its start and
  end, prints a line holding a credential-shaped canary, waits 2 s and puts the stand-in `claude` at
  `~/.local/bin/claude`, where Claude Code's own installer puts it.
- **The agent**: `fixtures/claude.pl`, Perl, so it runs with no developer tools and under the runner's sandbox.
  `--version` prints the newest version the facts cover. `auth status`, the probe the facts name, reads signed in while
  `<tmp>/agent/signed-in` exists, and its output carries a canary. `auth login`, the agent's own sign-in command, notes
  it started, prints a canary and returns at once: the page coming back, with nobody signed in. A headless job sends
  its prompt to the model and prints Claude Code's stream-json: the answer, or the API error `authentication_failed`
  (which the facts map to `sign_in_required`). A session waits until stopped.
- **The model**: a 127.0.0.1 server reached as `api.anthropic.com:443` through the job's `HTTPS_PROXY`, the runner's
  forwarder, whose upstream is the hub's `HTTPS_PROXY` (an existing seam in `egress.ts`). It keeps every prompt it
  got: that is how the tests see what reached the agent, and how often. It answers the research job from the test's
  answers (#1342's shape), holds one behind a gate when asked, and refuses with `authentication_failed` whenever the
  probe's file is gone when it answers, as the API refuses a lapsed token.
- **The person signing in** (`signIn`): writes the probe's file, `~/.claude.json` with an `oauthAccount`, as Claude
  Code's own sign-in does, and the Keychain stand-in's `Claude Code-credentials` with a canary token. **A lapse**
  (`lapse`): the probe's file gone and the token past its time.

## The contract (my choice)

The issue and the design name the runtime folder, `scripts/app-runtime.mjs` and its `--plant system-git`, `setup.step`
recording `install`, `DEEP_HUB_TEST_INSTALLER`, the sign-in task closed as `ask.moot` with `because: signed_in`, the
hub method `signin.open` and the plant `closes-on-return`. Where they leave a shape open, this is the plainest one, and
the implementation provides exactly this.

1. **The replica's runtime.** `deep-drive`'s `launch` takes `runtime: "<absolute folder>"`, the folder that stands for
   `DeepBuild.app/Contents/Resources/runtime/`; Set up then runs that folder's `bin/deep setup`, as the app runs its
   own. Without it the replica behaves as at the base.
2. **The release's archives** for `--archives` come from `node scripts/release-pack.mjs --repo <checkout> --commit
   HEAD --out <folder>` (#41's pack check, unsigned). A runtime folder holds `bin/deep`; after Set up,
   `~/.deepbuild/versions/current/` holds the copy, with `bin/deep` and `git/bin/git` (design).
3. **The first screen's install step**, as #1100's ids (its README, Pinned 1): a node `setup-step:install:<agent>` on
   `page/welcome`, one, for the agent Set up installs, and that agent's row `setup-agent:<agent>` whose words name it
   and say it installs (`/\binstall/i`). Setup's events: `setup.step` with `data.step: "install"` and `data.agent`.
4. **Where the agent lands.** `adapters/install.json` names Claude Code's program at `~/.local/bin/claude`, where its
   official installer puts it; the stand-in puts it there.
5. **The box's Send and the row's button**, over the hub's socket on the app's connection (`hello: "app"` with the
   control token): Send is `box.say {words}`, as the box sends it at the base; the button is
   `signin.open {ask: "ask:<id>"}`, the sign-in task's handle. The trusted path's confirmation is
   `DEEP_HUB_TEST_CONFIRM`.
6. **The sign-in task** is an `ask.created` of kind `unblock` whose `question` says sign in (`/\bsign(ed)?[\s-]?in\b/i`),
   raised after the Send or the lapse. Its question is the "one plain line". It closes with `ask.moot`,
   `data.because: "signed_in"`; any of `ask.moot`, `ask.answered`, `ask.cancelled`, `ask.superseded`, `ask.defaulted`,
   `ask.taken_over` or `ask.machine` on its subject counts as closing it.
7. **From a topic to a workspace** is #1342's merged contract (its README, The contract): the research job's prompt
   holds your words verbatim, its answer is `research.answer`, the card is the authority ask a `brief.drafted` names,
   approval is `deep inbox answer <card> <option>` (run here as the installed `~/.deepbuild/versions/current/bin/deep`),
   and `workspace.created` carries `workspace` and `folder`. Going back is `deep workspace revert <id> <commit>`.
8. **The plants:**

   | Plant | How it's selected | The wrong program | Read by | Its failure names |
   | --- | --- | --- | --- | --- |
   | `system-git` | `node scripts/app-runtime.mjs --plant system-git` (design) | the runtime folder with no `git/` | AC2 | the call: `git <subcommand>` of the first call the refusing `git` logged |
   | `install-button-beside-set-up` | `DEEP_HUB_PLANT`, the replica's `env-plants` build | a second button, named `Install Claude Code`, beside Set up | AC7 | the control: `button … "Install Claude Code"` |
   | `installs-other-agent` | `DEEP_HUB_PLANT`, in `packages/hub/src/plant.ts`'s closed list | setup installs Codex while the screen named Claude Code | AC8 | both: Claude Code and Codex |
   | `closes-on-return` | `DEEP_HUB_PLANT`, in `plant.ts`'s closed list (design) | the hub closes the sign-in task when the sign-in command ends | AC6 | the check: `ask:<id>`, `claude auth status`, `not signed in` |

9. **The clean account's evidence**, under `docs/evidence/1349/`:
   - `clean-account.mov`: the screen recording of the one run (the app opened from Finder, Set up pressed, a topic sent,
     the row's Sign in pressed, the person signing in in the agent's own page, the card).
   - `clean-account.json`: `{ "macos", "date", "had": { "agent": false, "node": false, "git": false,
     "developer_tools": false }, "topic": "<the words sent>", "signed_in_by": "person", "marks": [{ "at_s", "what" }] }`,
     the marks named exactly `opened from Finder`, `Set up pressed`, `box ready`, `topic sent`, `Sign in pressed`,
     `signed in` (the harness's sign-in step, marked) and `card`, in that order.
   - `deepbuild/`: a copy of that account's `~/.deepbuild` after the run, its `ledger.db` checkpointed (`versions/` may
     be left out).
   - `watched.json`: a person's call on the recording, `{ "who", "when", "files": { "clean-account.mov": "<sha256>",
     "clean-account.json": "<sha256>" }, "calls": { "AC1": "pass" | "fail", "AC6": "pass" | "fail" }, "note" }`: that it
     shows no terminal and no developer tools prompt (AC1), and a person, not the harness, signing in once from the
     row's button (AC6). The implementer doesn't write this file; the owner does, after watching.

   Without the first three, or without a `pass` recorded on exactly those files' bytes, AC1 and AC6's recorded-run
   tests read INCONCLUSIVE (a failure saying so, never a pass); a `fail` fails.

## The runner's first-reading gate

A runner job waits for its account's first plan-window reading (`runner.ts`, `window()`). This world reports no
reading: it relies on the design's new sentence, that an account whose sign-in task closed on its probe in DeepBuild
runs its jobs without a reading at once, since a person who has only signed in from the app has no session that could
report one. The base can't show it: it has no sign-in task, so at the base the research job either runs before anyone
signs in (AC6 fails there) or waits for a reading. The world's `~/.claude.json` names the account from the moment the
person signs in, as Claude Code's own sign-in writes it.

## Readings of what the criteria leave open

- **"No terminal and no developer tools prompt"** (AC1), on the fixture: no call reaches the refusing `git`, `xcrun`,
  `cc` or `node` over the whole journey, and the window reaches the box after the one press. On the clean account: the
  person's call on the recording.
- **"Reaches the box"**: the window leaves `page/welcome`, holds `box` or `box-draft`, and the keyboard is in it.
- **"Working history and going back"** (AC2): `main` has commits, read with the shipped git; a change kept with the
  shipped git goes back with `deep workspace revert`, which makes a new commit, keeps the old one and removes the file.
- **"Fails, naming the call"** (AC2): the first git call the refusing `git` logged has its subcommand named after
  `git` in something DeepBuild showed: the screen after Set up, `setup-stopped.json`, the box's or `deep inbox
  answer`'s reply, or an event's data in the record.
- **"Record and logs"** (AC3): every file under `~/.deepbuild` but the program copies under `versions/`. "A credential":
  any canary the stand-ins showed DeepBuild, in any form #19's sweep knows, or anything shaped like one.
- **"One plain line"** (AC4): one open sign-in task; its question has no line break, at most 200 characters, no exit
  status, error, braces or path, no credential, doesn't send you to a terminal, and names Claude Code. "Pauses": no
  card for the topic while lapsed. "Nothing lost": the card comes with your words and the first workspace keeps every
  commit.
- **The budget** (AC5) is timed from the press to the box ready, on the wall clock with one-second reads, minus the
  stand-in installer's logged time; there is no sign-in in Set up.
- **"Reach the agent once"** (AC6): the model got exactly one prompt holding the words, counted 10 s after their card;
  none before the person signed in. "Closes the row when the page returns": a closing event on the task before the
  person signed in, read 12 s (two probe periods) after the agent's sign-in command started and ended.
- **"One button with no agent found"** (AC7) is #1100's AC2 judge: the controls that write on `page/welcome` are the one
  `Set up` button.

## Not covered, because no criterion asks

The plan line and its price page; taking DeepBuild back leaving the agent installed; Linux and Windows; a browser
start (#1354); `scripts/app-bundle`; `app-runtime.mjs`'s refusal of a program linking outside the system's libraries;
a plan's limit as its own line.

## Files

- `helpers.ts`: IDs, plants, the runtime and replica builds, the fixture machine, the stand-ins and the model, the
  replica driver, the hub's socket, the judges, the evidence reader.
- `first-screen.test.ts` (AC7, AC8's screen), `journey.test.ts` (AC1–AC6, AC8's record), `plants.test.ts` (AC2, AC6,
  AC8's wrong programs), `clean-account.test.ts` (AC1, AC6's recorded run).
- `fixtures/claude.pl`, the stand-in agent. `tsconfig.json`, `BASE-FAILURE.txt`.
