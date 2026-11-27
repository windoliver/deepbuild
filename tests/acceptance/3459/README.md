# #3459 acceptance: `deep restore` keeps the record it replaces

Written blind from the issue (#3459 as `gh issue view 3459` printed it on 2026-11-26: its report, Runs on, Scope, seven
checkbox criteria and Proof; no comments), the design (How it installs: Backups; One event log, with tables built from
it; A hub of your own in the cloud: Moving; Scale later: a writer generation; the threat table's row on `deep restore`;
Dogfooding), `AGENTS.md` and the base `b134dd38f` (origin/main). No implementation was seen and none was written. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

At the base I read, for their surfaces: `packages/hub/src/backup.ts` (`deep backup`, `deep restore`, the sentence, the
marker, the last line), `packages/record/src/index.ts` (`prepareRestore`, `openRecord`, the events table) and `meta.ts`,
`packages/hub/src/confirm.ts` (the stand-in for the OS), `plant.ts`, `paths.ts` (`restore.pending`, `dropTestSettings`),
`vfs.ts` and `wire.ts` (the test VFS, `cutAt`), `server.ts` (the start that refuses on the marker),
`crates/deep-hook/default-rules.json` (`no-deep-restore`), `scripts/proof-change.mjs` (criterion IDs),
`scripts/twins-lint.mjs`, `scripts/alone-lint.mjs`, `scripts/wait-ratchet.mjs`, and the suites `572` (the restore
suite, whose helpers these are adapted from), `148` (a cut staged by `cutAt`), `3440`, `3430` and `3481` for their
conventions.

## Run

Node 24, the checkout built (`npm ci && npm run build --workspaces`), and deep-hook built
(`cargo build --locked -p deep-hook`) or given in `DEEP_BIN_DIR`; without it `authority.test.ts` is BLOCKED.

```sh
npx vitest run tests/acceptance/3459 --no-file-parallelism
```

About 12 to 22 s on the base. Every test points `HOME` at a temp folder of its own (`/tmp/dh3459-*`, removed after each
file), so the installed hub's root is `<tmp>/h/.deepbuild` and no real `~/.deepbuild` is read or written. Each file
starts real hubs (`deep hub run`) and stops each by its PID. Every child runs with `TZ=UTC` and `LC_ALL=C`. No test
waits for time to pass; the four timers in `helpers.ts` only bound a wait.

The OS confirmation is a boundary nobody here owns. Its only stand-in is the one #572's suite uses,
`DEEP_HUB_TEST_CONFIRM`, in its program form (`confirm.ts`: an executable is run once per ask with the sentence as its
one argument, and exit 0 is you confirming). The program keeps each sentence it is shown and confirms or cancels. No
test shows or clicks a real prompt.

## Requirement, check, proof

Every scene starts the same way (`makeScene`): a record with a wiki page and a pasted image; `deep backup` of it
through its running hub; then, after the backup, a second image, the page edited, a page added, the hub stopped, and
events appended through `@deepbuild/record` until the record holds exactly 40 events the backup lacks. The log is
checkpointed into `ledger.db` before the files are hashed.

| Criterion | Test | Passes when | Wrong program |
|---|---|---|---|
| `#3459.6fc3983f` the kept folder holds the replaced ledger, evidence and wiki, each equal by hash; `deep restore` of it gives a record with those 40 events | `kept.test.ts`, first test | `deep restore <backup>` exits 0 and its last line names the kept folder; the record in place holds none of the 40; `<kept>/ledger.db` and every file under `<kept>/evidence` and `<kept>/wiki` equal by SHA-256 what was under the root; the kept ledger holds the 40; `deep restore <kept>` exits 0 and the record then holds the 40, every other event of the replaced record, and its evidence and wiki | the merge base, which keeps nothing: the failure names the first event lost |
| `#3459.28771dde` the sentence names 40 events past the backup's last and the newest one's time; another record's backup reads as not taken from this one, with this record's count | `sentence.test.ts`, two tests | (1) the sentence shown for the earlier copy holds `40 … events`, and the newest event's day and hour:minute, and doesn't read as not taken from this record; (2) the sentence shown for a backup of a record under another home holds `not … taken from` and this record's event count before `events`. Both prompts are cancelled | the merge base; twin `sentence-names-folders-only`: the failure lists what was left out |
| `#3459.cd3c8ee1` each kept file has the inode it had before the restore | `kept.test.ts`, second test | every kept file's inode and device equal those of the file that was under the root before the restore | twin `keep-copies`: the failure names each file |
| `#3459.a9ca2cbc` a cut between the move aside and the put leaves the marker; no hub starts; a rerun ends with the restored record in place and the kept folder whole | `cut.test.ts` | under the staged cut (below) `deep restore` ends by SIGKILL after its one point `restore_aside`; `restore.pending` is there; a folder under the root holds the replaced ledger, evidence and wiki whole; `deep hub run` ends without starting, naming `deep restore <backup>`; the rerun exits 0, removes the marker, leaves the backup's events, evidence and wiki in place and none of the 40, names the same kept folder on its last line, still whole; a hub then starts | twin `swap-deletes-before-move`: the failure names the kept ledger |
| `#3459.e4e3976d` a second restore says, before the OS asks, that it replaces the folder kept from the first, by its day | `second.test.ts` | the sentence shown for a second restore differs from the one shown for the same restore with the kept folder taken out of the root, and names the kept folder's day once more than that one does | twin `second-restore-unsaid`: the failure names the folder |
| `#3459.b8f5554f` an agent's `deep restore` of the kept folder is denied; yours changes nothing until the OS confirms you | `authority.test.ts` | deep-hook, with the shipped rules and the hub stopped, denies `deep restore <kept>` and `sh -c 'deep restore <kept>'`, naming the command; your `deep restore <kept>` with the prompt cancelled asks once, fails, and leaves the record's events, every file's hash and inode under the root and under the kept folder as they were; confirmed, it exits 0 and the 40 events are back | the merge base (no kept folder) |
| `#3459.4a7ca7c9` after a restore of the kept folder, the hub reports a generation above the backup's and the replaced record's, on every connection | `generation.test.ts` | with G the generation the hub reported before the first restore (the kept folder's) and R the one it reports after it (the record the second restore replaces), after `deep restore <kept>` the hub reports one integer above both G and R on a hook, an app and a cli connection | the merge base (no kept folder) |

`BASE-FAILURE.txt` has each test's failure on the base.

## What the implementer builds, as the tests read it

- **The kept folder.** One folder under the root (`~/.deepbuild`), with a backup's layout: `ledger.db`, `evidence/`,
  `wiki/`. Its name is the implementer's. The tests never guess it: they take it from the last line.
- **The last line.** The last non-empty line of `deep restore`'s stdout holds `deep restore <kept folder>`, the folder
  written as an absolute path or with `~/`, bare or in quotes or backticks, and a `.` after it is allowed. A path with
  a space in it isn't read. A rerun after a cut names the same folder.
- **The sentence.** The words handed to the OS confirmation (`Confirmer.you`'s first argument), so the stand-in sees
  them. See below for what the tests match.
- **The staged cut.** See below: one new point kind, `restore_aside`, on the test VFS that exists.

No `DEEP_HUB_PLANT` name is asked for: the wrong programs are twins (`twins.json`, `twins/README.md`), and the tests
run unchanged on each.

## The sentence

The issue fixes what the sentence says, not its words. The tests read it with the two folders taken out and match:

- **"40 events past the backup's last"**: the number 40, not part of a longer number, followed within 60 characters
  and the same sentence by `event` or `events`.
- **"The newest one's time"**: the newest of the 40 is the last appended, newest by log position and by time. The
  sentence must hold its day and its hour and minute, in UTC since the command runs with `TZ=UTC`. The day in any of
  `2026-11-27`, `27 Nov 2026`, `27 November`, `Nov 27`, `November 27th`, `27/11/2026`, `11/27/2026`, `27.11.2026`; the
  time as `06:53`, `6:53`, `06:53:42`, `T06:53` or `6:53 AM`. A relative time ("two minutes ago") doesn't pass: the
  criterion says its time.
- **"Not taken from this one"**: `not` or `n't`, then `taken from`, with no full stop between: the issue's own words.
- **"This record's event count"**: every event in the record there (45 in the base run), followed by `event(s)` as
  above. The other record is one under another home, with a hub ID and events of its own.
- **The second restore**: the day the kept folder was made (the day of the first restore, UTC), in the spellings above,
  once more often than in the sentence of the same restore when no folder is kept. The sentence needn't name the
  folder's path.

## The staged cut

Nothing at the base can stop `deep restore` between two of its steps: #572's suite stages no cut inside the swap, and
`deep restore` reads no test VFS. The nearest surface is the test VFS's `cutAt` (`DEEP_HUB_TEST_VFS`, `vfs.ts`,
`wire.ts`), with which #148's suite cuts a sync right after a named durable point. This suite asks for the same
surface on `deep restore`, and names it exactly:

- `deep restore`, run with `DEEP_HUB_TEST_VFS={"points":"<file>","cutAt":{"kind":"restore_aside","nth":1}}` under a
  root that isn't your account's own (`dropTestSettings` already drops it there), makes one durable point of kind
  `restore_aside`: right after the replaced ledger, `evidence/` and `wiki/` are in the kept folder and that move is
  synced, with the marker already written, and before anything of the backup is put in their place.
- Under `cutAt` the process then ends as the test VFS ends one, by SIGKILL to itself, and the point is one line
  `{"n":…,"kind":"restore_aside"}` in the points file. The test asks for exactly one such line.
- Without the variable nothing changes.

## Planted programs

`twins.json` names one twin for each criterion whose wrong program the merge base isn't, and for the sentence, and
`twins/README.md` says what each breaks, the file its lines likely change and the assertion it fails at. Their
`lines.json` are the implementer's to add once the lines they replace exist.

## How the tests were checked

On the base all eight fail at an assertion (`BASE-FAILURE.txt`). Since most of each test lies past its first failing
assertion, the helpers were also driven once against the base with a kept folder made by the test's own hand, in a
temporary test file that isn't kept (`BASE-FAILURE.txt`, last paragraph). No product file was edited and no stand-in
implementation was written, so no test has been seen to pass whole, and no twin has been planted.

## Not named by the issue, so assumed

- **Where the kept folder's name comes from**: the last line, above. `deep doctor` names it too by the Scope; no test
  reads it there.
- **"Each file equal by hash to what was there"**: `ledger.db` after a full checkpoint, so its bytes are the record's,
  and every plain file under `evidence/` and `wiki/`. The wiki's last-written file beside its folder and the WAL
  aren't asked for. The kept folder may hold more.
- **"A record with those 40 events"**: the 40 by ID, and with them every event the replaced record held.
- **"The inode it had"**: inode and device, of the same files as above.
- **"No hub starts on it"**: `deep hub run` ends with a failing exit and no ready line, as it does on the base's
  marker, naming `deep restore <backup>`.
- **"The kept folder whole" after the cut**: found as the folder under the root, at most two levels down, whose
  `ledger.db` has the replaced ledger's inode; after the rerun, as the folder the last line names, which must be the
  same one.
- **"Before the OS asks"**: in the sentence the OS shows, as the Scope says ("its sentence says so"). A line printed
  to the terminal before the prompt isn't read.
- **"By its day"**: the day the first restore ran. The test takes the kept folder out of the root by a rename and puts
  it back, which the Scope allows ("removing it is yours"); a build that can't ask with the folder gone fails.
- **"Denied as any restore is"**: with the hub stopped, directly and through `sh -c`. #572's suite has the hub up too.
- **"Changes nothing"**: the record's events, and the hash and inode of the ledger, evidence and wiki files under the
  root and under the kept folder.
- **"A generation above the backup's"**: the backup restored is the kept folder, whose generation is the one the hub
  reported before the first restore. "Above" is asked, not "one above".

## Not covered here

- **`deep doctor` naming the kept folder with its size and the day it was made** (Scope): no criterion names it.
- **That the kept folder is made before the backup's files go in, in the uncut run**: only the cut shows the order.
- **A cut at any other step**, a cut during the rerun, and a restore of the kept folder that is itself cut.
- **What a third restore's sentence says**, and that the second restore's kept folder holds what it replaced.
- **A sentence for a record that holds nothing past the backup's last.**
- **The hub up for the agent's denial**, and a real OS prompt.
- **The Proof's readings** (the sentence on the change beside the merge base's, and the rest) are the implementer's
  evidence.
- Linux wasn't run. Nothing here is macOS-only, but inodes across a rename assume the kept folder is on the root's
  file system.

## Lanes

`lane.json` runs the folder alone (`binary`): every file starts real hubs, which take deep-hook from this checkout's
`target/`, and `authority.test.ts` runs deep-hook from there when no `DEEP_BIN_DIR` is given.

## Files

- `kept.test.ts` (two tests, one scene), `sentence.test.ts` (two tests, one scene), `cut.test.ts`, `second.test.ts`,
  `authority.test.ts`, `generation.test.ts`: each test top-level, its title starting with its criterion's tag, no subtests.
- `helpers.ts`: homes, the CLI, the OS stand-in, hubs and their connections, the scene, the kept folder, hashes and
  inodes, days and times, deep-hook.
- `twins.json`, `twins/README.md`: the planted programs. `lane.json`, `tsconfig.json`, `BASE-FAILURE.txt`.
