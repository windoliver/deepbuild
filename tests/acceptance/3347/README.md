# Acceptance tests for #3347: a fixture for hands is never a person

Issue #3347: "A fixture for hands is never a person: #1186's test clip is drawn, or its maker's written agreement is recorded beside it, and a fixture that says neither fails".

Written first, blind, on November 24, 2026, at the base `863761023` (origin/main), by a job that never saw the work. It read no other branch but the one that holds the design text below, and no other pull request, worktree or session. The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft by this job (design: Dogfooding).

## Sources

- **Issue #3347**: its account, Scope, three criteria, Proof and Depends on. Issues #3267, #1186, #1187, #1189, #3345 and #3346, read the same way.
- **The design**: Privacy, Seam and backend: device classes, and Capture, as `node scripts/design-section.mjs --issue 3347` prints them, and #3267's decided text for the first two: "A fixture is never a person", and "A marked class's fixture, and the clip a test build reads in place of the camera, is never a person". AGENTS.md. The reference Macs in `docs/technical-design.md`.
- **The base, for surfaces only**: `scripts/repo-rules.mjs` and `.json`, `scripts/lanes.mjs`, `scripts/proof-approvals.mjs`, `scripts/proof-change.mjs` (`criterionId`), `.deepbuild/approvers`, the README's "Approve an edit to a check", `tests/fixtures/approver.mjs`, `crates/deep-show/reference-macs.json`, and the suites `tests/acceptance/3139/`, `2327/` and `1326/` for the house format. Nothing is imported from another suite.

## Run

```sh
node --test tests/acceptance/3347/*.test.mjs
```

Plain `node:test` and Node 24 built-ins. The tests also need git and OpenSSH's `ssh-keygen`; a plant that `ssh-keygen` can't read throws `BLOCKED:`. The suite takes about 10 s on the base, and about 20 s on a program that passes, plus what #1186's clip's script takes and one `node scripts/repo-rules.mjs` over this checkout (about 30 s).

Nothing is written in the checkout. Scratch repositories and trees live under the system's temporary folder (`deep-3347-*`), are removed in `t.after`, hold no copy of this checkout's `.git`, and read no git configuration of the machine's. `GIT_*` variables are dropped from every child. Keys are made in memory. No person, hand or real clip is in any plant.

## The surface, and what is yours to provide

The issue leaves these open. This is the whole of what the tests reach; wording, key order and layout beyond it are free.

| What | Where and how |
|---|---|
| A fixture for a marked class | Any file git lists (tracked, or new and not ignored), whatever its extension, at any depth under a folder `fixtures/hands@1/` in any part of the repository, as `packages/contracts/fixtures/<name>@<major>/` already names its folders. Four kinds of file there are not fixtures: a statement (`*.statement.json`), a `README.md`, a text file that a statement in the same folder names as its script or its agreement, and that agreement's `.sig`. Text means no NUL in the first 8,000 bytes, as the repo rules already tell text from binary, so a binary file is a fixture whatever names it. Anything else a script needs lives outside the folder. `pen@1` is not marked, and neither are `touches@1`, `motion@1` and `midi@1` |
| A statement | `<fixture's file name>.statement.json` beside the fixture: a JSON object whose `statement` is the string `drawn` or the string `agreed`. Paths in it are relative to its folder |
| `drawn` | `script`: the script that drew it |
| `agreed` | `who`: who was recorded. `use`: the use they agreed to. `agreement`: `{"file": …, "sha256": …}`, the agreement's file and its SHA-256 in lower-case hex |
| An agreement | One text file. It holds `who` and `use` as the statement spells them, and the fixture's own SHA-256 in lower-case hex |
| Its signature | `<agreement's file name>.sig` beside it, as `ssh-keygen -Y sign -n git -f <key> <agreement>` writes it. The namespace is `git`, the only one `.deepbuild/approvers` gives its keys |
| Who may sign | A key on `.deepbuild/approvers` as the merge base of HEAD and `origin/main` holds it, signing as the edit guard counts it: a security key, with the touch made |
| #1186's clip | The one fixture whose statement has `"for": "#1186"`. No other fixture's statement says so. Elsewhere `for` is optional |
| Running a drawn clip's script | `<script> <path to write>`: a program with the executable bit and a `#!` line, in any language, run with the checkout's root as its working folder. It writes the clip to that path, makes the same bytes each time, and exits 0. The tests run it in a tree that stands for the checkout **without the clip** and without `.git`: the clip's folder is a copy, everything else is a link, so a built tool under `target/` and `node_modules/` are where they always are. A script that can't run for want of a tool prints a line that starts `BLOCKED` and exits non-zero |
| The check | `node scripts/repo-rules.mjs`, run as a process. Whether its code is in that file or in another under `scripts/` is free, and so is the check's name |
| Its lines | One line a fixture, each naming it by its path from the repository's root. A fixture that passes: a line that starts `PASS ` and holds the path and then its statement, `drawn` or `agreed`. These lines are the list. A fixture that fails: a line that starts `FAIL ` and holds the path, and no `PASS` line for it. The line of a missing or changed agreement also names the agreement's file; the line of a key that isn't listed also names the key, by its `SHA256:…` fingerprint or in full |
| The detector's reading | `node scripts/hands-reading.mjs <clip>`, once #1186's backend is in the checkout: it has that backend, and no detector of its own, read the clip through `camera.clip`, and prints `PASS`, `FAIL` or `BLOCKED`, the clip's path and `<share> of <count> frames`, the share of the frames with one hand of 21 points as a decimal from 0 to 1. `PASS` from 0.95, with exit 0; anything else exits non-zero |

## Criteria and tests

Each ID is `#3347.` and the first 8 hex digits of the SHA-256 of the criterion's text, trimmed, white space collapsed (`criterionId` in `scripts/proof-change.mjs`).

| ID | Criterion, in short |
|---|---|
| `#3347.fc5ea222` | AC1: the check passes a `drawn` fixture with its script and an `agreed` one with a matching agreement signed by a listed key; a clip with no statement, a missing or changed agreement and an unlisted key each fail |
| `#3347.e7d2e863` | AC2: #1186's clip states `drawn` or `agreed`; its script makes its hash again and the detector reads it, or its agreement names the maintainer, the use and the hash |
| `#3347.0c0a0f6e` | AC3: the check lists every fixture for a marked class with its statement, and #1186's clip is on the list |

Every plant of AC1 runs beside a drawn and an agreed fixture that must pass in the same run, so a check that fails everything fails these tests, as does one that passes everything. The base is a wrong program for every test: it has no such check and no clip, so it passes a clip with no statement in silence. The wrong programs below are further ones; each was run (`BASE-FAILURE.txt`).

| Test | What it checks | Wrong program it fails on |
|---|---|---|
| `ac1-statement` 1 | A drawn fixture with its script, and two agreed ones whose agreements are signed by two listed keys, of the two security-key types, each have a `PASS` line and no line in a failing state | The base; a check that lists drawn fixtures only |
| 2 | A clip with no statement: `FAIL`, naming the clip. The same clip with its statement and script beside it passes | A check that walks the statements, or passes what has none |
| 3 | An agreement that is missing, and one that is signed and true but isn't the file the statement's hash names: `FAIL`, naming the file | A check that never opens the agreement, or never compares the hash |
| 4 | An agreement signed by an unlisted key: `FAIL`, naming the key. One with no signature, and one edited after it was signed with the statement's hash moved to the edited file: `FAIL`, naming the clip | A check that takes a missing signature, reads the signer but not what was signed, or doesn't name the key |
| 5 | The stranger's key added to the list in the working tree, then committed by the change, then alone on the change's list: its agreement fails each time and the maintainer's passes. With no merge base, the agreed fixture has no `PASS` line and a failing line says so | A check that reads the list from the working tree, from HEAD, or from HEAD when there is no merge base |
| 6 | A listed security key used with no touch, and a listed key in a plain file: `FAIL` | A check that only asks `ssh-keygen -Y verify`, which takes both |
| 7 | A statement that is neither, both, empty or not JSON, `drawn` with no script or one that isn't there, `agreed` with no agreement, no `who` or no `use`: `FAIL`, naming the clip | A check that never looks for the script, or takes any statement |
| `ac2-clip` 1 | #1186's clip states `drawn` or `agreed` | The base; a clip with no statement for #1186 |
| 2 | Drawn: the script makes the clip's hash in a tree without the clip. Agreed: its agreement names the maintainer, the use and the clip's hash. The judges are first run on planted scripts and agreements | A script that copies the clip, or draws another; an agreement to another recording |
| 3 | An agreed clip whose agreement, signed and matching its hash, names another recording's hash: `FAIL` | A check that takes one signed agreement for any recording |
| `ac2-reading` 1 | On a reference Mac #1186's backend finds one hand with 21 points in at least 0.95 of the drawn clip's frames | BLOCKED at the base. Later: a reading under 0.95 |
| 2 | A planted drawn clip with no hand in its 60 frames (`plants/no-hand.swift`): `FAIL`, naming a share under 0.05 | BLOCKED at the base. Later: a reading that passes every clip |
| `ac3-list` 1 | A clip, a recorded track and a run, in three `fixtures/hands@1/` folders, one nested and one new to git, each listed with its statement. Then a clip, a track and a run that state nothing, and a clip that states nothing and that another fixture's statement names as its script, each named. A `pen@1` fixture is never failed. The planted check the criterion names, `twins/skips-unstated.mjs`, passes the same tree, and the judge fails it, naming each clip it skipped | That planted check; one that reads one folder, one extension, or tracked files only; one that leaves out whatever a statement names; one that fails every class |
| 2 | On this checkout the list holds #1186's clip and every other hands@1 fixture, each with its statement | The base; a checkout whose clip the check fails |

## Verdicts other than PASS and FAIL

- **BLOCKED**: a throw whose message starts `BLOCKED:`, the house convention (2,000 and more in `tests/acceptance/`), so it never reads as a pass or a skip. Both tests of `ac2-reading.test.mjs` throw it until #1186's backend and its `camera.clip` are in the checkout, naming them, and then until `scripts/hands-reading.mjs` is, naming it. A `BLOCKED` line from that command, and from a clip's script that can't run, is the test's own BLOCKED.
- **How a test knows the backend is missing**: no Rust file under `crates/` holds the string `"hands@1"`, or none holds `"camera.clip"`. At the base neither is there.
- **INCONCLUSIVE**: a throw whose message starts `INCONCLUSIVE:`. The detector's reading on a Mac that `crates/deep-show/reference-macs.json` doesn't list, and a child that doesn't finish.

## Readings where the issue leaves a choice

1. **Where a fixture lives, and what a statement is.** The table above. A folder by class is how the repo keeps versioned fixtures; a file outside such a folder is no fixture for the class. JSON, since the issue asks for a hash beside words.
2. **"Naming the file."** The agreement's file, by its name. Scope also has the check name the fixture, so both are asked.
3. **"Naming the key."** Its fingerprint or the whole public key. A principal isn't enough: an unlisted key has none.
4. **"Signed."** A detached signature, the plainest one the list's own tool writes. A signature over other bytes is none, and neither is no signature: "an agreement is in writing when its maker signed it".
5. **"Signed with a key on `.deepbuild/approvers`, the list the edit guard reads, so no agent can write it for them"** (Scope). The guard counts only a security key's signature with the touch made (`scripts/proof-approvals.mjs`; README, "Approve an edit to a check"), so an agreement's signature is held to the same. Neither the plain key nor the untouched one has to be named.
6. **No merge base.** Nothing missing passes (AGENTS.md), so an agreed fixture is not listed as passing. Which failing state, and whether the line names the fixture or the list, is free.
7. **An agreement to another recording.** AC2's agreed half has the agreement name the clip's hash, and Scope has it say what was recorded. The check holds that too: without it one signed agreement would cover any later recording.
8. **A statement's parts.** Scope lists what each carries, so `drawn` without its script and `agreed` without `who`, `use` or the agreement is no statement. A single `statement` string can't say both; anything but the two words is neither.
9. **"Running its script again gives the clip's own hash."** Run where the clip isn't, or a script that copies it would pass. SHA-256 of the whole file.
10. **The exit status.** A scratch repository fails other repo rules (no physics build), so a pass is read from the lines. A failing plant must exit 1.
11. **"On the reference Mac."** Any of the three the design names.
12. **If #1186's clip is `agreed`**, the first reading test asks nothing more once the detector is there; the planted clip's test still runs.

## Not covered here

- That the clip runs 20 s, shows the three poses in order and carries the corner pattern (Scope), and that `camera.clip` plays this file: #1186's own criteria and its tests judge those.
- Whether a statement is true. A script that holds a recording's bytes, or a recording kept outside a `fixtures/hands@1/` folder, is for review.
- The agreement's words on where it may be kept and shown and on withdrawing it, and replacing a withdrawn agreement's fixture.
- #1187's labeled set and #1189's clip: their tasks build them, and the folder rule reaches them.
- A class marked after `hands@1`: #3345 builds the mark.

## Files

- `helpers.mjs`: the scratch repository, the runner, the judges, the planted fixtures, the software authenticator, the tree without the clip, and the detector's gate and reading.
- `ac1-statement.test.mjs`, `ac2-clip.test.mjs`, `ac2-reading.test.mjs`, `ac3-list.test.mjs`: the tests above.
- `twins/skips-unstated.mjs`: the planted check AC3 names. No `twins.json` lists it, since it replaces no file of the checkout.
- `plants/no-hand.swift`: draws the planted clip with no hand. Run only once there is a detector to read it.
- `BASE-FAILURE.txt`: the base run, redacted, and the runs on a stand-in and on each wrong program.
