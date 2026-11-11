# Acceptance tests for #2018: one reading of a session, its state, its why and its name, with the `session.row@1` kit

Written first and blind, at base commit `7c5e1cc8d`, from issue #2018 (updatedAt 2026-11-10T23:36:08Z: its Scope, six
acceptance criteria and Proof), the design and the base, before any implementation. The implementing agent does not edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). There is no taste criterion, so no
`TASTE.json`.

## What was read

- Issue #2018, live; the titles and states of #4, #329, #1453, #578, #2020 to #2025 (open), #1463, #1461, #1462, #2026 (closed);
  and the bodies of #2019 (the flags) and #2026 (the one count), for their terms.
- `docs/technical-design.md` at the base: States people see (the table and the row shape), the deep CLI and DeepBuild app rows of
  the component table, the kits (`needs-you@1`, `session.row@1`, `return.card@1`), One list and one page, Sessions that know about
  each other, Dogfooding. `docs/canvas-primitives.md` was searched for the same terms and holds none of them.
- At the base: `packages/hub/src/{status,plant}.ts`, the `Interrupt` hook in `packages/hub/src/core.ts`, `packages/cli/src/main.ts`
  (`deep status [--json]`), `crates/deep-replica/src/{main,kit}.rs` and `drive/mod.rs` (`see`, `act`, `launch`, `close`),
  `crates/deep-app/src/{states,list,views,lib}.rs` (the table, the headings, the row's slots, `sessions()`), the contracts' event
  fixtures, `scripts/proof-change.mjs` (criterion IDs), `scripts/lanes.mjs`, and the suites `1463`, `1461`, `1459`, `992`, `39`,
  `26`, `16`.

### What the issue's edit changed, and what changed here for it

This suite was first drafted from the issue as it read at updatedAt 2026-11-10T21:23:30Z, and finished from the issue as it reads
at updatedAt 2026-11-10T23:36:08Z. The earlier text was not kept, so what differed is read off the draft, which quoted it:

| The draft held | The issue says now | Changed here |
|---|---|---|
| A table of eleven rows: needs you, sent back, BLOCKED, INVALID, INCONCLUSIVE, stale, says done, working, queued, PASS, quiet | Fourteen: needs you, **stuck**, **flagged**, sent back, BLOCKED, INVALID, INCONCLUSIVE, stale, says done, working, queued, PASS, **finished**, quiet | `TABLE` in `helpers.ts` holds the fourteen in that order, with the entries the design's table gives the three new words at the base (`stuck` blocked, `flagged` fail, `finished` idle); `stateFailures`, `whyFailures`' "for each higher row the fact it lacked" and their judges follow it |
| A judge example that a row reading `finished` is no row of the table | `finished` is a row | The example is a job's `running`, which the design's table holds and the issue's fourteen don't; every one of the fourteen is held to pass |
| Flags "beside one of the eleven state words" (the count #2019 still quotes) | "Retrying, repeating, interrupted and watch-only are flags in the right slot beside one of the fourteen state words, not states" | `FLAGS` in `helpers.ts`; a row whose `word` is a flag fails `stateFailures`, naming it a flag |
| AC5's interrupted session was a process gone mid-turn, which no row of the eleven matched | The design's `flagged` row is "a session whose process is gone mid-turn", so that session's state is `flagged` | AC5's interrupted session is a Codex turn you interrupted, played through the hub's `Interrupt` hook (#39), which the base reads as "its turn was interrupted"; its state must be one of the fourteen with "interrupted" beside it |
| AC5's quiet session was a turn that stopped with no claim three days ago | `finished` ("a session whose turn stopped with no claim to judge" in the design) comes before quiet, so that session's first matching row is `finished` | AC5's quiet session started three days ago and has no turn at all, which no row above quiet matches |
| The generated test failed at the base on the word `finished` alone | The base's six words (needs you, stuck, flagged, working, finished, quiet) are all rows now, so that test would pass at the base | The generated test also holds each session to the first row its facts match, where the issue and the design leave no room (`expected` in `helpers.ts`, Pinned 2): at the base a claim with no verdict reads `finished`, not `says done` |
| The needs-you clause had no wrong program | (unchanged) | It passes at the base, so the plant `stale-before-ask` was added for it (Pinned 2) |

The six criteria read word for word as they did, so `criteria.json` and the IDs are unchanged. The issue's list and the design's
table agree at the base on every one of the fourteen words and its entry; the design's table also holds `running`, a job's word,
which no session reads. The Scope's "needs you (an open ask, or your words whose delivery stalled or timed out)" and "every row
not in PASS says whom it waits for and what it needs" are in "Scope the criteria don't cover" below, beyond what AC2 names.

## How to run

With Node 24.22 first on `PATH`, the workspaces built (`npm ci --ignore-scripts; npm run build --workspaces`), `deep-hook` and
`deep-replica` built (`cargo build --locked -p deep-hook -p deep-replica`), cargo on `PATH`, on macOS:

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2018 --no-file-parallelism
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2018 judges     # the judges alone, anywhere
node node_modules/typescript/bin/tsc -p tests/acceptance/2018/tsconfig.json
```

- **Builds.** The helpers build the replica's `deep-replica` binary, and `deep-drive` with `--features env-plants` and then
  plain, once a run, with #1172's build environment (`CARGO_INCREMENTAL=0`, `CARGO_PROFILE_DEV_DEBUG=0`), each copied out of the
  target folder into `$TMPDIR/dd2018-bin-<uid>-<8 hex of the checkout's path>`, so `target/debug` holds the plain build afterwards
  and another worktree's build never stands in. `CARGO_TARGET_DIR` is honored.
- **Folders and processes.** Homes and outputs are under `/tmp` (#16's `tempDir`; a socket path must fit 104 bytes). Nothing
  touches the real `~/.deepbuild`, `~/.claude`, `~/.codex` or `~/Library/LaunchAgents`. Only what a test started is stopped, by
  PID. The OS confirmation is #24's stub, `confirmed`. No network, no model.
- **The generated test** draws six worlds from seed 2018, each five to eight sessions, each world a real hub started three times;
  a failing world is shrunk at most four steps.
- **`--root` cache.** Vitest writes `tests/acceptance/2018/node_modules/.vite/`; delete it before committing.
- **Lanes.** `scripts/lanes.mjs` needs `tests/acceptance/2018/` in `alone` (it builds `deep-drive` twice, starts real hubs and
  many replicas, and the replica draws on macOS only), as `alone.push('tests/acceptance/2018/')`. This job writes only under
  `tests/acceptance/2018/`; the implementer makes that edit.

## The surface (my choice where the issue names none)

The readers are the real ones: `deep status`, its `--json` and `deep status <session> --why` from the built CLI against a real
hub in a temp HOME; the app's list, pages, menus, menu bar and notifications as the real `deep-drive` reads them, launched with
`launch.from: "record_copy"` in the same HOME, so it copies that hub's record; and `deep-replica --view-kit session.row@1 <dir>`,
as `deep install` runs a view's kit. No reply, label or log line credits a criterion.

### Pinned here: the implementation must provide these

1. **The kit.** `deep-replica --view-kit session.row@1 <dir>` (the base's command line, #1459) prints one JSON line, the last
   line of its stdout: `{"result":"pass"}` with exit 0, or `{"result":"fail","names":"session:<session ID>: <what is wrong>"}`
   with exit 1; `names` starts with the id of the row that is wrong. New here:
   - `sessions()` of `@deepbuild/panel` gives each session, beside the base's `id`, `title`, `words` and `entry`, **`asks`**: the
     hub's count of that session's open asks, a number, `0` with none.
   - A replacement row shows that count in an element of its own inside its row `session:<id>`, with the id
     **`session:<id>:count`** and the number as its text. A session with no open ask has no such element. The kit reads the count
     there, and such an element is no row.
   - The kit fails, naming the row: a row that doesn't draw its session's `words` (so "done" where they hold "says done"); a
     count element whose number isn't the hub's count for that session; a count element on a row whose session has no open ask.
   - It names one wrong row a run. The suite draws that row right and runs the kit again, until it passes: a kit that names a row
     again once it is drawn right fails, and so does one that never passes.
   - **The kit's fixture record** holds at least one session with a stop that claims done and no verdict yet, whose `words` hold
     `says done`. With no such session the "done" sidebar equals the right one and the test fails.
2. **States.** `deep status --json` (#1463's `{log_pos, rows}`) holds exactly one row `session:<session ID>` for each session.
   Its `word` is one of the fourteen (needs you, stuck, flagged, sent back, BLOCKED, INVALID, INCONCLUSIVE, stale, says done,
   working, queued, PASS, finished, quiet) and its `entry` that word's status-map entry (`needs_you`, `blocked`, `fail`, `fail`,
   `blocked`, `invalid`, `inconclusive`, `stale`, `running`, `running`, `idle`, `pass`, `idle`, `idle`). No row's `word` is a flag
   (retrying, repeating, interrupted, watch-only). The word is the same with the hub up, from the database with the hub stopped
   (exit 0 or 3), after the record's own replay (`rebuild`) on a copy, at the same `log_pos`, and after a hub restart.
   - **The first matching row**, held only where the issue and the design leave no room: a session with an open ask reads
     `needs you`. With no ask open, no answer waiting to be delivered, no `session.gone`, no tool call left running, and nothing
     after its newest claim (`agent.stop` with `claim: true`, then `claim.made`) but that claim's `verdict.made`, a
     `verdict.stale`, a `claim.sent_back` and asks since gone moot, it reads: `says done` with no verdict; `BLOCKED`, `INVALID` or
     `INCONCLUSIVE` for that verdict; `PASS`; `stale` for a PASS gone stale; `sent back` for a FAIL that was sent back. Every other
     walk is left to the implementation, and so is a session to whose record the hub added a stop, claim, verdict, ask, prompt,
     call or task of its own.
   - **Needs you, on every surface**, for the session with an open ask and a stale PASS: its `--json` row (`word: "needs you"`,
     `entry: "needs_you"`); the line holding its title in `deep status` and in `deep`, with `needs you` and without the word
     `stale`; its row in `see`'s `rows`; its node `session:<id>` in the app's tree, with `needs you` and without `stale`; the node
     `session:<id>:word`, named `needs you`; the `menu_bar.items` entry holding its title, with `needs you` and without `stale`;
     its page node `session/<id>`, with `needs you`; and a notification the replica posts for it (its trace's `notifications[]`,
     `session` the ID), with `needs you` and without `stale`.
   - **BLOCKED with no open ask** reads `BLOCKED · waits for <owner>: <evidence>`, here `BLOCKED · waits for you: a run of
     publish-check.sh`: whole, in the session's block of `deep status` (its line and the lines indented under it), and in one name
     or string value inside its node `session:<id>` of the app's tree. Its `--json` row has `word: "BLOCKED"`, `waits_on: "you"`
     and the evidence in some field.
   - **Plants**, read by `deep`'s own process through `activePlant()` (`DEEP_HUB_PLANT`); the hub runs without them:
     - `stale-before-ask`: `deep status` (text and `--json`) reads a session that has an open ask and a stale verdict as `stale`,
       the stale row tried before needs you.
     - `blocked-bare`: `deep status` (text and `--json`) reads the BLOCKED row bare: `BLOCKED` with no `waits for <owner>:
       <evidence>` in its text, and in `--json` `word: "BLOCKED"` with `waits_on: null` and the evidence in no field.
3. **Group counts.** In `see`'s snapshot each group's heading is the node `heading:<group>`: `heading:needs-you`, and
   `heading:<project>` by the repo folder's name (the base's ids). A heading that shows a count carries it as its `value`, a whole
   number (a number or a string of digits); at least one heading does. Needs you's count is the number of ask rows in `rows` and
   of `ask:<ULID>` nodes drawn; a project's count is the number of ask rows in `rows` whose `project` is that group. Both hold
   against `see`'s own `rows` and against `deep status --json` at the same `log_pos`.
   - **Plant**, read by the app through `crate::plain::planted("group-count-moot")` in the replica built with
     `--features env-plants`: `group-count-moot`, each group count the list shows counts the asks that went moot too, so the
     fixture's Needs you (and shop, if it shows a count) reads one more than its open asks.
4. **Names.** A session with no task is named by the first line of its first prompt. That name is: its `--json` row's `title`;
   in the line of `deep status` that lists it; in its node `session:<id>` of the app's tree; in the node `page-title` of its page
   (`open` `session/<id>`); and in the first line of the text of a notification posted for it. With one such session none of
   those holds its ID in any form (whole, its first 8 characters, its letters and digits, or their first 8). With two, each of
   those but the `--json` `title` also holds its own short ID, the session ID's first 8 characters, and none holds the other's;
   whether a twin's `title` adds the short ID is left open, since the row carries its `id`.
5. **`--why`.** `deep status <session ID> --why --json` exits 0 and prints one JSON object:
   `{"log_pos": <n>, "id": "session:<session ID>", "word": "<the row that matched>", "why": "<one sentence>", "facts":
   [{"kind": "<event kind>", "ts": <ms>, "log_pos": <n>}, …], "lacked": [{"row": "<word>", "fact": "<what it lacked>"}, …]}`.
   `word` and `why` are the row's in `deep status --json` at that `log_pos` (a length of time in the sentence may differ) and in
   the app's row; `why` is one line; `facts` is not empty and each fact is the record's event at that `log_pos`, with that kind
   and time; `lacked` holds one entry for each row of the table above `word`, in the table's order, each with a non-empty `fact`.
   A record holding only the events at the facts' `log_pos`, read by a hub whose clock starts when `--why` was asked, gives the
   session the same `word`. `deep status <session ID> --why` exits 0 and prints the sentence, and for each fact a line holding
   its kind and its `log_pos`.
   - **Plant**, read by `deep`'s own process: `why-second-reading`, `deep status <session> --why` (text and `--json`) is built
     from a reading of its own and says `quiet` for a session the table reads as working.
6. **Rename.** With a session's page open, `see`'s `menus` holds a menu titled `Session` with an enabled item whose title
   starts with `Rename`. Picking it (`act` `{kind: "menu", path: ["Session", <title>]}`) leaves `snapshot.focus` the id of a node
   inside `page-title` whose role ends in `text_input` and which holds the session's name. `cmd-a`, the new name typed, `enter`:
   the node `session:<id>:title` is named the new name, the row no longer holds the old one, and `page-title` holds the new one.
   `see`'s `hub` then lists at least one call whose params name the session (its ID, or its letters and digits) and the new name,
   none refused. Each such call, sent as it is to the real hub on an app connection, gets a `result`; after it the session's
   `--json` row has the new name as its `title`, and `deep status` has a line with it and none with the old one.
   - **Plant**, read by the app through `crate::plain::planted("no-rename")` in the env-plants build: `no-rename`, an app with no
     way to rename: no Rename item in the Session menu (or it is disabled, or picking it puts no caret in the title). The same
     build with no plant chosen renames as the plain build does.

### Merged surfaces, used as they are

`deep hub run` with `DEEP_HUB_TEST_CLOCK` and `DEEP_HUB_TEST_CONFIRM`; `DEEP_HUB_PLANT`; the hook protocol (#16's `sendHook`,
`hookRequest`, `newSession`), Codex's `Interrupt` hook among it (#39); `events.read`; the record and asks core (`openRecord`,
`rebuild`, `raise`, `tick`) through #26's `seed`; `deep status`, `deep status --json` and `deep` (#1463); `deep-drive --out
<dir>` with `launch` (`from: record_copy`), `see` (`snapshot`, `rows`, `log_pos`, `menus`, `hub`), `open`, `act` (`menu`, `type`,
`press`), `wait_for` and `close` with its trace; the row's slot nodes `<id>:title` and `<id>:word`, `page-title`, `heading:<group>`;
the replica's `env-plants` feature; `deep-replica --view-kit`.

### The fixture

`helpers.ts`, `makeWorld`: each repo a git folder under one temp folder; the played hooks through a real hub from a `sleep`
stand-in process, that hub's clock half an hour back; then, with it stopped, the seeded events through the record and asks core,
each in its kind's published shape (the contracts' fixtures); `setup-finished.json`; and a real hub again.

`mainWorld` (AC2's surfaces and BLOCKED, AC3, AC5), eight sessions in `shop`, `docs` and `search`, times counted back from when
the fixture is made:

| Key | Repo | Title | What the record holds |
|---|---|---|---|
| `needs` | shop | Cart totals | a stop that claims done, PASS, the verdict gone stale, and the open ask *Keep the cart on SQLite or plain files?* |
| `moot` | shop | Checkout page | the ask *Which header colour on the login page?*, gone moot, and a tool call still running |
| `working` | shop | Search box | a tool call started 2.5 min ago and not ended |
| `blocked` | docs | Publish check | a stop that claims done, BLOCKED with `a run of publish-check.sh` still missing, its open item, and the unblock task *Create a registry token for the publish check?*, which took its default |
| `saysdone` | docs | Release notes | a tool call, then a stop that claims done, with no verdict |
| `ask2` | docs | API guide | the open ask *Which accent colour for the API guide?* |
| `quiet` | search | none | a session that started three days ago and nothing since: no task, no prompt, no turn |
| `interrupted` | search | tune the ranking | played: a Codex session's start, that prompt, a shell call begun, then `Interrupt`; no task is seeded |

Two asks are open (shop 1, docs 1), one went moot (shop) and one took its default (docs). `name.test.ts`: Claude Code sessions
played through SessionStart, the prompt *fix the flaky checkout test* and one tool call, with no task, each then given an open
ask so the app notifies; one such session beside another prompt, then two with the same prompt in one repo. `rename.test.ts`: a
working session titled *Billing page* and one other. `states.test.ts`' generated worlds: five to eight sessions over the three
repos, each a walk over task, prompt, toolStart, toolEnd, stop, claim, the five verdicts, stale, sentBack, ask, answer, moot and
gone; a step the walk can't take where it stands is passed over. `fixtures/views/`: `rows-right`, `rows-done` and `rows-count`,
three replacement sidebars written against `@deepbuild/panel` as the base's `1459-session-rows` fixture is.

## Criterion to tests

IDs are `criterionId` in `scripts/proof-change.mjs`; `criteria.json` lists them with their text.

| Criterion | ID | Tests | Wrong programs it fails on |
|---|---|---|---|
| AC1 | `#2018.b912741a` | `kit.test.ts`: `rows-right` passes the kit; `rows-done` (reads "done" where a row's words hold "says done") and `rows-count` (every row shows one more than the hub's count) each fail it, the kit naming a row a run until every named row is drawn right | the base (its kit passes both wrong sidebars: its fixture holds no stop without a verdict, and it reads no count); a kit that names a row the view drew right, or never passes; `judges.test.ts` |
| AC2 | `#2018.2b9628d8` | `states.test.ts`: six generated worlds, every session one row of the fourteen with its entry, the first matching row where the issue leaves no room, the same from the database, after a replay to that `log_pos` and after a restart; the session with an open ask and a stale verdict reads needs you on each surface; the BLOCKED session reads `BLOCKED · waits for you: a run of publish-check.sh` in `--json`, `deep status` and the app's list | the base (a claim with no verdict reads `finished`; the BLOCKED session reads `finished`, its line bare); `stale-before-ask`, naming `deep status`'s line and its `--json` row; `blocked-bare`, naming the row in both; `judges.test.ts` |
| AC3 | `#2018.f054ee4c` | `counts.test.ts`: every group count the list shows is the length of its list, against `see`'s rows and `deep status --json` at one `log_pos`, with a moot ask in the group | `group-count-moot`, naming `heading:needs-you` or `heading:shop` and no group without a moot ask; `judges.test.ts` |
| AC4 | `#2018.c1948faa` | `name.test.ts`: the one session reads *fix the flaky checkout test* in `--json`, `deep status`, the sidebar row, its page's title and its notification, with no ID; two such sessions each add their short ID and never the other's | the merge base, naming each surface (`Claude Code` in `deep status`, the row and the notification; `Session <8 hex>` on the page); `judges.test.ts` |
| AC5 | `#2018.63948766` | `why.test.ts`: for the sessions reading working, quiet, says done and interrupted, `--why --json` in its shape, its word and sentence the row's, every fact in the record at its `log_pos`, a `lacked` entry for each higher row, the same sentence and facts as text and in the app's row, and a hub over only those facts reading the same word | the base (no `--why`); `why-second-reading`, naming the session and the row; `judges.test.ts` |
| AC6 | `#2018.13e5e71e` | `rename.test.ts`: Session › Rename, the caret in the page's title, Return, the row and the title; the app's calls sent to the real hub, then `deep status` and its `--json` | the base (no Rename item); `no-rename` in the env-plants build, after that build with no plant renames; `judges.test.ts` |

Three criterion-tagged tests pass at the base on purpose (`BASE-FAILURE.txt`): AC1's `rows-right` (a right sidebar passes the
kit, which guards against a kit that fails everything); AC2's needs you on every surface (the base already reads an open ask
first; its wrong program is the plant `stale-before-ask`, whose test fails at the base); and AC3's right counts (the base counts
open asks; its wrong program is the plant `group-count-moot`, whose test fails at the base).

## Scope the criteria don't cover

No criterion names these, so nothing here tests them: a row's time moving only when work changes hands; the stuck, flagged and
queued rows, and needs you through "your words whose delivery stalled or timed out"; badges and the return card reading the one
function; "every row not in PASS says whom it waits for and what it needs", and an INVALID or INCONCLUSIVE row naming its open
item's evidence and owner (only AC2's BLOCKED fixture is held); counts on a session's page and in Numbers, and a count with no
list drawn without a link; the name's first three sources (the name you gave it before any rename, its task's title, the
agent's own session title), the cut to 60 characters, and the canvas outline; the state word opening why, and why under the
page's title; the #1453 reads (the one-line row, what a working session is doing, a lead's children counts, a press anywhere
opening the page, Note and pause, no filter, no tabs, "project" for "repo", unread); where a flag is drawn, and the retrying,
repeating and watch-only flags (#2019); the Proof's 30 sessions at the reference window.

## Disputes and assumptions a redraft may revisit

1. **Which count a row shows (AC1).** The suite reads "a count other than the hub's" as the hub's count of the session's open
   asks, the count AC3 and the Scope's "counts that equal the hub's" speak of, given to a view as `sessions()[i].asks` and drawn
   in `session:<id>:count`. The Scope's #1453 read also gives a lead's row its children's counts (#2020); a redraft may pin
   those instead, or both.
2. **The oracle's reach (AC2).** The issue gives each row a word and an order, and a fact only for needs you; the design's table
   gives one line a word. `expected` holds a session to a row only for an open ask and for a settled claim, and abstains
   elsewhere. A redraft with the table's facts in hand may hold every row. It also assumes a hub leaves a seeded claim with no
   verdict unjudged; a session the hub adds facts to is left out, and the test fails if fewer than six sessions are judged.
3. **"Interrupted" (AC5).** The fixture is a turn you interrupted in Codex, the one reading the base calls interrupted
   (`its turn was interrupted`). #2019 will read an app quit, a usage limit and a session that exited mid-turn as interrupted too;
   the design's `flagged` row holds a process gone mid-turn. The test asks only that "interrupted" stands in the session's
   `deep status` block, its why or its row in the app's list, beside a state word of the fourteen; it pins no slot (#2019) and
   no state word for it.
4. **The owner and the evidence (AC2).** `open_item.opened` has no owner field at the base. The owner is `you`: the unblock
   task's owner, and the verdict's next step at the base (`next: you`). The evidence is the open item's `text`, which the
   fixture's verdict also gives as its `smallest` and its one reason.
5. **The whole BLOCKED reading in one text.** `deep status` may break it over the row's line and its detail lines, but the
   app's row must hold it in one name or value; a row that splits it across slots reads bare.
6. **`--why`'s JSON shape and `lacked`.** The issue names what `--why` prints, not a shape; Pinned 5 is this job's. "For each
   higher row the fact it lacked" is read as exactly the rows above, in order.
7. **Recomputing "from only those facts".** A fresh record holding only the named events, read by a real hub at the moment
   `--why` was asked. A `--why` that leaves out a fact its state needs (the session's start, say) reads another word there.
8. **Rename's save.** A replica's calls never reach a hub (#1462), so the suite sends the app's own calls to the real hub and
   then reads `deep status`. The method's name and params are the implementation's; the suite needs only that they name the
   session and the new name.
9. **The CLI-side plants** run in `deep`'s process only, as #1463's do. If the rows come from the hub, the plant still has to
   change what `deep` prints, not what the hub builds.
10. **A session with no task (AC4).** The base's hub makes a task of a Codex prompt, titled by the prompt, and none of a Claude
    Code prompt; the sessions are Claude Code's. A hub that makes a task of every prompt fails the fixture's own check ("has no
    task") before any surface is read.
11. **Short ID.** The session ID's first 8 characters, as the base writes one in `deep status`. The base starts every session's
    line in `deep status` with it; the suite reads "its ID shows only to tell apart two rows" as no ID on the line of a session
    whose name no other row reads, so that column goes for it. A redraft may leave `deep status`'s own column out of the rule.
12. **Group ids.** `heading:<project>` by the repo folder's name is the base's; a heading that shows no count is not held to
    one, and the test fails if no heading shows a count.

## Files

- `helpers.ts`: the IDs, the table and the flags, the builds, the seeder, the player, the fixtures and `makeWorld`, the readers
  (`deep`, `--json`, `--why`, the replica, one `log_pos`, the kit), the generator's walk and its oracle, and the judges. Reuses
  `../16/helpers.ts` (hub, hooks, sessions, temp folders, PIDs) and `../26/helpers.ts` (seeding).
- `kit.test.ts` (AC1), `states.test.ts` (AC2), `counts.test.ts` (AC3), `name.test.ts` (AC4), `why.test.ts` (AC5),
  `rename.test.ts` (AC6); `judges.test.ts`, no app and no criterion tag, passes at the base.
- `fixtures/views/{rows-right,rows-done,rows-count}/main.js`: the three replacement sidebars.
- `criteria.json`, `tsconfig.json`, `BASE-FAILURE.txt`.
