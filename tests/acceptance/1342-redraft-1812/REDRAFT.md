# #1342 criteria AC2 `#1342.23ee5c69` and AC6 `#1342.435612ed` blind redraft, after #1812: the fixture project is made with `deep workspace new … --json`

#1342's AC6 needs "a fixture holding a project that fits". `tests/acceptance/1342/home.test.ts` makes it in its trip
world (`tripScene`) with #67's `deep workspace new "Family trips"`, and reads the new workspace's `id` from the line of
JSON that command prints: the research answer for the weekend in Porto names that `id` as the project the work fits,
and the test reads that workspace's tasks. The scene is BLOCKED unless the command exits 0 and prints an object whose
`id` is a string. AC2's test runs the same scene for its trip half. #1812's Scope, fifth item: "A command a person runs
prints a sentence, and JSON only with `--json`: `deep fix`, `deep workspace`, `deep rules` and `deep numbers refresh`".
The line #1812 adds to the design's deep CLI row ends: "What a person runs prints sentences, and JSON only with
`--json`." A correct program then prints a sentence for `deep workspace new "Family trips"`, the scene finds no object,
and both tests end BLOCKED before their first assertion about the trip. The criteria still hold. The redraft keeps
every scene, research answer, plant, judgement and assertion, and changes one call: `deep workspace new "Family trips"
--json`, read the same way.

## What was read

- Issue #1342 (closed), live: `gh issue view 1342 --repo windoliver/deepbuild --comments`, and its body with `--json`:
  Scope, the twelve criteria, Proof, Depends on, and its one comment ("Done in windoliver/deepbuild#2502 (not merged).
  One decision is open there: which blind suite is the proof."). The twelve IDs were recomputed from the live body as
  `scripts/proof-change.mjs` computes them; AC2 `#1342.23ee5c69` and AC6 `#1342.435612ed` are the frozen suite's.
- Issue #1812 (open), live, the same way: Scope, the eight criteria, Proof, and the owner's two comments (the tracker
  review of Nov 9 and the audit's numbers of Nov 10). Neither comment names `deep workspace`.
- #1812's blind suite at the base, `tests/acceptance/1812/`: README.md first (Surfaces pinned here, Choices, Not
  covered), helpers.ts, its eight test files and tsconfig.json; of its `BASE-FAILURE.txt`, the first 30 lines and the
  lines naming `workspace` (only the hub-down rows). Tests, not an implementation.
- The design at the base, `docs/technical-design.md`: the deep CLI row under One hub per user, a tiny hook client, and
  extensions in-process, with the base's commit `014919052`, the one line #1812 adds to it; States people see; the
  Dogfooding bullet. `AGENTS.md`.
- The frozen suite, `tests/acceptance/1342/`: README.md, APPROVED-WORLD-FIX.md, helpers.ts, forge.ts, home.test.ts,
  lisbon.test.ts, tsconfig.json and BASE-FAILURE.txt. Its `fixtures/claude.pl` was not opened. What it imports by path,
  for what those helpers do: `../29/h-d.ts` (`CLI`, `DEEP_HOOK`, `stopHub`, `control`, `allEvents`, `childEnv`) and
  `../1332/helpers.ts` (`must`, `mustFail`, `shown`, `waitUntil`).
- For form: `tests/acceptance/19-redraft-2073/` (REDRAFT.md, BASE-RESULTS.txt, tsconfig.json, the head of
  watchonly.test.ts) and `tests/acceptance/556-redraft-ac5/README.md`. Beyond that list, also for form: the first 80
  lines of `tests/acceptance/139-redraft-1802/REDRAFT.md`, and the test names and imports of `1718-redraft-1720/`. Both
  are at the base, and neither is #1812's work.
- The base `c0a9de979` (main at `16dc5eab0` plus #1812's blind suite, its design line and its lint lane entry), read
  only for how the surfaces are driven: `packages/cli/src/main.ts` (the help words, `unsupported`, and a first argument
  holding white space going to your words), `packages/hub/src/workspace-command.ts` (what `deep workspace new` parses and
  prints), `workspaces.ts` (`make`, the object), `hub-control.ts` (`workspace.new`), `words-command.ts` (`deep
  "<words>"`: its sentence, `--json` and exits), `inbox.ts` and `list.ts` (the exits of `deep inbox answer` and `deep
  status --json`), the lines of `packages/hub/src/` that read `DEEP_HUB_TEST_CONFIRM` (the hub, `server.ts`),
  `scripts/proof-change.mjs`, `scripts/lanes.mjs` and `scripts/throttle.mjs`.

I never read an implementation of #1812, any commit after the base, any branch, pull request or other worktree. One
thing to disclose: while its deep-hook build waited for a build slot, this job read the machine's throttle table and the
command lines and working folders of the queued builds, to find its own. One was another agent's worktree, building
deep-hook too; only that folder's path was seen, and nothing in it was read.

## What #1812 changes, test by test

| Original (path › test) | Criterion | Why the old expectation no longer holds under #1812 | Replaced by |
|---|---|---|---|
| `tests/acceptance/1342/home.test.ts` › AC2 #1342.23ee5c69 "plan a five-day trip for four people under $4,000" makes a workspace with no repo and no forge call, and "a small site that tracks my reading list" makes a repo. A planted flow that asks which fails, naming the ask | AC2 `#1342.23ee5c69` | After its site half it awaits `tripScene()`, whose first step is `deep workspace new "Family trips"`, BLOCKED unless that exits 0 and prints an object whose `id` is a string. #1812's Scope, fifth item, puts `deep workspace` among the commands that print "a sentence, and JSON only with `--json`", and its design line says "What a person runs prints sentences, and JSON only with `--json`". A correct program prints a sentence, so the trip half ends BLOCKED ("#67's deep workspace new "Family trips" makes the fixture's project") before any of its assertions | `tests/acceptance/1342-redraft-1812/home.test.ts` › the same name with " (redraft 1812)": the same steps and assertions, the fixture made with `deep workspace new "Family trips" --json` |
| `tests/acceptance/1342/home.test.ts` › AC6 #1342.435612ed A fixture holding a project that fits shows it on the card, and answering with it adds the work there | AC6 `#1342.435612ed` | Its first step is the same `tripScene()`. The fixture's `id` is the project the Porto answer fits (`fits: family.id`) and the workspace whose tasks the test reads, so the scene must read it from the command. BLOCKED the same way, before "the fixture holds the project" | `tests/acceptance/1342-redraft-1812/home.test.ts` › the same name with " (redraft 1812)": the same |

| Part of the scenario | In #1342's test | In the redraft |
|---|---|---|
| The fixture project | `deep workspace new "Family trips"`; BLOCKED unless it exits 0 and prints an object with a string `id`; its `id` and `folder` kept | Changed: `deep workspace new "Family trips" --json`, with the same check on the same object, read by the frozen helpers' reader (the whole stdout as JSON, else its last line that starts `{`) |
| AC2's site half | the box's Send, the list read for 20 s while the research job waits, the card approved, the repo the forge was asked for | Kept as it is |
| AC2's trip half | `deep "<trip>" --json` exits 0 at its card; only the card asked; a workspace made after the approval; no repo and no forge write | Kept as it is |
| AC2's plant | `asks-which-home`: the flow asks which, and the judgement fails naming `ask:<id>` | Kept as it is |
| AC6 | `deep "<Porto>" --json` reaches its card; one yes names "Family trips"; answered with it, the card's tasks become that workspace's tasks and no workspace is made | Kept as it is |

The test file is a copy of the frozen one, with three tests left out (below) and only the lines above changed: the
header, the two import paths, the call and its BLOCKED message, and the two names. `helpers.ts` and `forge.ts` are
imported from `../1342/` unchanged; the research answers and the plant are the frozen file's. `git diff --no-index
tests/acceptance/1342/home.test.ts tests/acceptance/1342-redraft-1812/home.test.ts` shows exactly that.

## Kept as they are

Ten of the twelve tests. Each runs only surfaces #1812 leaves as they are, in a world whose hub answers:

- `home.test.ts` › AC4 `#1342.2121cb90`, AC5 `#1342.b66acc8d` and AC11 `#1342.bbf1fbc9`: the site world and their plants
  (`creates-before-approval`, `repo-public-by-default`, `empty-list-while-researching`). None runs `deep workspace`. The
  redraft's file leaves them out, with the judgements only they use (`nothingBefore`, `privateRepos`, `oneRow`). It
  keeps the site scene whole, its frames included, because AC2 runs it.
- `lisbon.test.ts` › AC1, AC3, AC7, AC8, AC9, AC10 and AC12: one world, through `deep "<words>" --file <notes> --json`,
  `deep inbox --json`, `deep inbox answer`, the record and the workspace's git. None runs `deep workspace`.

The surfaces they use, against #1812:

- `deep "<words>" [--file <path>]... --json`: the suite always passes `--json`, and at the base this command already
  prints a sentence by default and its JSON only with `--json` (`words-command.ts`). Its first argument holds white
  space, which the base routes to your words, so "'Unsupported command' is for a word that isn't a command" doesn't reach
  it; none of the suite's arguments is `help`, `-h` or `--help`. Its exit at the card stays 0 (Readings, 3).
- `deep status --json` (the frozen helper's `frame`) and `deep inbox --json` (its `inbox`): JSON with `--json`, as #1812
  keeps it. A frame needs exit 0; #1812's 3 is for a hub that isn't answering, and the hub answers through every frame.
- `deep inbox answer <card> <option>` (the frozen helper's `approve`, exit 0): #1812 sends a cancelled confirmation to
  3. The world's confirmation stub answers `confirmed` (the frozen `helpers.ts` writes it, and the hub reads it through
  `DEEP_HUB_TEST_CONFIRM`), so nothing is cancelled, and an answered card is done: 0.
- `deep hub run`'s first line, `{"ready": true, …}` (the frozen helper's `startHub`): the hub itself, on no list of
  #1812's; #1812's own suite reads it the same way (its `hubRun`). The hubs are stopped by PID and the record is read
  over the socket (`../29/h-d.ts`), with no `deep` command.
- AC9's refused brief: the test reads what the command and its asks print, the promise's text, and no exit code. The
  base exits 2 for a refused brief, and #1812's table calls a refusal 1. Whichever #1812's work settles, no test of
  #1342 reads it.

## Readings where #1812 leaves room

1. **Where `--json` goes**: after the topic, `deep workspace new "Family trips" --json`. #1812's suite pins `deep fix
   ACME-43 --json`, "the flag after the ID", and this suite's other JSON reads put it last too (`deep status --json`,
   `deep inbox --json`, `deep "<words>" … --json`). #1812 pins no usage line for `deep workspace new` and no form with
   `--folder`; neither is used here.
2. **What `--json` prints**: "the object it printed before". At the base, `deep workspace new <topic>` prints the hub's
   reply on one line, `{"id": …, "folder": …, "name": …}` (`workspaces.ts`, `make`). The test reads `id` and `folder`
   from it as the frozen test did, through the frozen reader, and holds no more of it: #1342's test never held the
   object byte for byte. Holding it whole is #1812's to prove; its suite does that for `deep fix` (its AC7) and leaves
   `deep workspace` uncovered (its README, Not covered).
3. **`deep "<words>"` at its card exits 0.** #1812's table: "0 done · 1 failed or refused · 2 not understood, nothing ran
   · 3 not decided or not checked". The command is done when its card is ready; the card then waits in your list as an
   ask. #1812's own suite reads `deep start approve … --json` the same way: it raises an approval ask and must exit 0
   there (`undecided.test.ts`, BLOCKED otherwise). #1812's examples of 3 are a check not done (an update check with no
   network, a setup whose wiki wasn't read) and a decision you didn't make (a cancelled confirmation). So AC2's `deep
   "<trip>" --json` exit 0, and `lisbon.test.ts`'s `cardOf`, stay as they are.
4. **The sentence isn't read.** No criterion of #1342 reads what `deep workspace new` prints without `--json`, and
   running it a second time would leave the fixture with two "Family trips" workspaces, which would change what AC6's
   card can offer. The sentence is #1812's to prove, and its suite leaves it untested (Not covered).
5. **BLOCKED stays BLOCKED.** The frozen check is the scene's precondition, not an assertion of a criterion, so its word
   stays: a program whose `deep workspace new … --json` doesn't print the object can't set up AC6's fixture, and that is
   never a pass (AGENTS.md, the second invariant). Only the call and the command its message names change.
6. **No new flag**: #1812 allows none "beyond `--json` where a sentence replaces JSON". `--json` on `deep workspace new`
   is that flag, so the redraft asks for nothing #1812 rules out.

## Wrong programs they still fail

- `asks-which-home`, AC2's plant: the same judgement, naming `ask:<id>`, as in the frozen test.
- A program whose `deep workspace new` takes no `--json` (the base), prints the object only without it, prints it on
  stderr, or drops its `id`: both tests end BLOCKED at the fixture, never a pass.
- Whatever else the frozen AC2 and AC6 fail on, since every other line is theirs.

## On the base

`BASE-RESULTS.txt` holds the one run at `c0a9de979`, on November 18, 2026: 2 tests, 2 failed, in 44 s, at a one-minute
load of 446 to 519 on 18 cores.

- AC2 (redraft 1812): FAIL, at the call #1812 changes: "BLOCKED: #67's deep workspace new "Family trips" --json makes
  the fixture's project: exit 2", with the base's usage of `deep workspace`. The base's `deep workspace new` takes no
  `--json`, so its three arguments fit none of the command's forms. The site half passed first, every assertion of it
  (the box took the words, the card came, nothing else was asked, the forge was asked for a repo after the approval), so
  on the base the test reaches #1812's surface and fails there, not before.
- AC6 (redraft 1812): FAIL, the same BLOCKED. It awaits the trip world AC2 started, whose first step is that call.

Not run: any implementation of #1812 (none exists here), so the passing side, `deep workspace new … --json` printing the
object, is unverified; and nothing after that call, so the trip half of AC2 and all of AC6 are unrun at this base. This
job ran no other suite, the frozen one included.

## Run it

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:/opt/homebrew/opt/rustup/bin:$PATH"
npm ci && npm run build --workspaces
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook   # the played sessions' hooks
NO_COLOR=1 node scripts/throttle.mjs test --wait 120 -- node node_modules/vitest/vitest.mjs run --root tests/acceptance/1342-redraft-1812 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1342-redraft-1812/tsconfig.json
```

Each world lives under `/tmp/dh1342-*` and is removed at the end; every process is stopped by its PID, as the frozen
helpers do. The folder is on `scripts/lanes.mjs`'s `alone` list beside `tests/acceptance/1342/`, since every test starts
its own hubs. Vitest with `--root` leaves `node_modules/.vite/` here; delete it.

## At merge

The frozen `tests/acceptance/1342/home.test.ts` stays as written; once #1812 lands, its AC2 and AC6 end BLOCKED at the
fixture. Taking these two in their place is the owner's call. They carry the same tags, `#1342.23ee5c69` and
`#1342.435612ed`. The frozen suite's APPROVED-WORLD-FIX.md names an earlier blind redraft of this suite (`50697f597`),
which "confirmed the gap" in the world's plan-window reading and "wasn't taken, because it chose a different contract".
This one is the redraft #1812's Scope asks for ("An exit or a line an acceptance suite pins moves only through that
suite's blind redraft"). It keeps the frozen contract and world, the approved window fix included.
