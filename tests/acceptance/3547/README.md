# Acceptance tests for #3547: a shard no run has used for three days is removed by the next run that claims shards

A blind job wrote these tests before any work on #3547 existed, from these inputs only:

- issue #3547: its opening paragraphs, its Scope (the "Not in this task" line too), its six acceptance criteria and its
  Proof;
- the issues it names, for the words it cites: #1324 (the epic), #2673, #3515 (the alternates a reused shard keeps),
  #2574 (`claimShards` in a temporary `HOME` with `DEEP_TEST_SHARD_FLOOR=0`) and #1017 (the disk floor);
- the design sections it links: `docs/parallel-proof.md`, sections 7a and 9; `AGENTS.md` and `CONTRIBUTING.md`;
- the base commit `2edb19ff4`, which removes no shard. There I read `scripts/shards.mjs`, `scripts/affected.mjs` where
  it calls it, `exactTree` in `scripts/lanes.mjs`, `scripts/proof-runs.mjs` (how a twin is laid and what "fails at its
  assertion" is), `scripts/wait-ratchet.mjs` and `scripts/repo-rules.mjs` (what the lint lane holds a suite to), and
  the suites `2574`, `2820`, `3221`, `3567` and `tests/shards.test.mjs` for conventions.

No test imports the code under test, and the helpers are written here. Per AGENTS.md the implementing agent doesn't
edit these files; a dispute goes to a blind redraft by this job.

## Run

```sh
node --test tests/acceptance/3547/*.test.mjs
```

The tests are offline, on real processes and real folders: this checkout's real `scripts/shards.mjs`, real git, `du`,
`cp` and `ps`. Nothing is stubbed. With the files side by side the suite took 15 to 35 s on a program that held the
criteria (the throwaway guess, below), in seven runs at a 1-minute load of 42 to 157 on 18 cores, all passing, and
17 s on the base at a load of 44. Each test has its own limit (240 s), and each step of a run has one too (60 s): a
step that hangs fails its test at its limit, naming the step.

**No test lists, reads or writes the machine's `~/deepbuild-shards`.** The script is never loaded by a test's own
process. Every process that loads it gets a `HOME` in the test's temporary folder, so `homedir()` and
`~/deepbuild-shards` are the test's own, with `DEEP_TEST_SHARD_FLOOR=0` as #2574's suite has it, a `TMPDIR` there, and
`NODE_OPTIONS`, `NODE_TEST_CONTEXT` and every `GIT_*` variable of the suite's own environment taken out. Each run
starts in a process group of its own and is signalled only through that group's PID, its own: SIGSTOP and SIGCONT
where a test holds a removal still, SIGKILL after a test for a run still going. Criterion 3 kills one process it
started, by its PID. Nothing is stopped by name or port, and the temporary folder is removed.

**The disk.** The script takes a shard only while the disk holds 5 GB for it above the floor, here 0. The largest
claim in the suite is of two shards, as criterion 1 names, so the disk that holds the temporary folder needs 10 GB
free; with less, a test fails saying which shard it was not given, with the script's own `not used` line.

No `lane.json`: the suite needn't run alone. No line is needed anywhere else in the repository.

## The setup (`helpers.mjs`)

- **A sandbox** (`sandbox`): the `HOME`, with a git identity of its own so nothing git notes in a shard names a
  person, a `TMPDIR`, and a scratch git repository with one commit, an untracked file git doesn't ignore,
  `node_modules/`, a package's `dist/` and `target/`.
- **A run** (`start`, `claimOnce`): one node process that calls `claimShards(root, want, say)` as
  `scripts/affected.mjs` calls it, with `say` printing each line as `affected.mjs` prints it. Its test tells it each
  step over the channel node gives a child process: claim, give back, end. What it was given is the folders
  `claimShards` resolved with; what it printed is its output.
- **The shards a test starts from** (`make`): made by this checkout's own script. One run claims them one at a time,
  each while it holds those before it, as runs side by side would, so shard `k` is made at `~/deepbuild-shards/<k>`
  with room on the disk for one shard at a time. It gives them back, or goes on holding the ones a test names: those
  locks are the script's own and name a live process. Each shard gets a stamp in its ignored `target/`, which a shard
  made again doesn't have, and is then aged.
- **A removal stopped half way** (`untilRemoval`): the folders of the shards a run should remove are watched from
  before its start. When the first entry leaves one (a folder's modification time changes, or the folder is gone), the
  run's whole process group is stopped with SIGSTOP, so the removal stands still while the test looks or starts a
  second run; SIGCONT lets it go on. Such a shard holds thousands of empty folders in its `.git` (`ballast`), which
  take a remover about a second, so the stop comes part way. A test whose run had ended before the stop fails, saying
  so: nothing unseen passes.
- **Weight** (`weigh`): build products in a shard's ignored `target/`. Where the disk clones files they are
  copy-on-write clones of one 128 MiB file, made with the `cp` the script itself clones with: `du` counts each whole
  and the disk holds one, as with a real shard's files (the issue's own note). Elsewhere they are real copies of a
  2 MiB file.

## Aging

The issue names no clock to set, and says "last made a tree" was read from each shard's `.git/packed-refs`, "which
`prepare` writes at each use". So a shard four days old, or an hour old, is one made by the script and then aged by
every time it keeps, so that any reading sees the same age:

- the modification and access times of every file and folder of the shard, `.git/packed-refs` among them, and of its
  lock folder when it has one, set with `lutimes` (`age`);
- the dates git records: the claim that makes or last uses the shard runs with `GIT_AUTHOR_DATE` and
  `GIT_COMMITTER_DATE` at that age, so the shard's own commit (`ORIG_HEAD`) and its reflog carry it too.

The guess (below) passed reading the age from `.git/packed-refs`, from the times of the shard's folder, `.git/HEAD`
and its index, and from the date of the shard's own commit. A time a test can't set is not aged: a file's change time
and birth time, and a date the script might write into a file's content. A program that reads one of those sees
every shard as new, and fails here.

## The surfaces assumed where the issue is silent

1. **A run that claims shards** is a process that calls `claimShards(root, want, say)`, the one place a run claims
   them (`scripts/affected.mjs`, `prepare`). It is the smallest surface that sees each criterion on real processes and
   folders: a whole `affected.mjs` run adds a scratch tree, a grant and its jobs, and reaches the shards through this
   one call. So the removal must happen in the process that called `claimShards`, between the call and that process's
   end. Before the claim, after it, or in a later turn of the event loop all pass (each was tried in the guess).
2. **"Is given"**: the folders `claimShards` resolves with. **"The folder"**: `~/deepbuild-shards` of the `HOME` the
   process was given; a shard is an entry named by a number alone, its lock is `<k>.lock`. **"Afterwards"**: once the
   run has given its shards back and its process has ended.
3. **"The folder holds 1, 2 and 6"**: its entries named by a number alone are exactly those, each still holding the
   worktree's tree, shard 6 being the folder it was (its stamp), and no other entry starts with a digit (a lock, a
   folder moved aside). Whether shards 1 and 2 are reused or removed and made again is not held.
4. **A lock that names a live process** is the script's own lock, taken by a run that still lives and holds the
   shard. **A process that is gone**: that run, killed with SIGKILL. No test writes a lock, so none depends on what a
   lock folder holds. "So does its lock": the lock folder holds the same files with the same text afterwards.
5. **What a run prints** is its process's stdout, line by line: what `say` gets, and anything the script prints
   itself. **"The lines the merge base prints"**: `SHARD <k> <dir>: made, at tree <tree>, node_modules cloned` and
   `SHARD <k> <dir>: reused, at tree <tree>`, one for each shard given, in any order, with nothing on stderr and exit
   0. `<tree>` is worked out by the test with git, through an index of its own.
6. **"The run's line"** is the one line of a removing run beyond those; a second such line fails ("one line"). **"The
   count"**: a whole number of its own on that line, with no byte unit, equal to how many shards the run removed (4:
   no removed shard is numbered 4, and the rule names no 4). **"The bytes"**: a number with a byte unit (`B`,
   `bytes`, `kB`, `MB`, `GB`, `TB`, `KiB`, `MiB`, `GiB`, or `K`, `M`, `G` alone, in either case; `K`, `M` and `G` are
   read both as powers of 1,000 and of 1,024), or a bare whole number read as bytes, that is within the last digit it
   prints, or 3%, of what `du -sk` gave for the removed shards' folders just before the run, times 1,024. The line
   may say anything else. That it lists the shards' numbers is not held: the criterion asks for the count.
7. **"While one process removes shard 4"**: from the first entry leaving shard 4's folder until the test lets that
   process go on. **"Made new"**: the second run's line for shard 4 says `made`, the folder holds the worktree's tree
   and nothing of the folder that was being removed, and it still does once the first run has ended. **"Another"**: a
   shard other than 4 that holds the worktree's tree. The second run asks for two, so its claim reaches shard 4, and
   must be given two.
8. **"Two runs never remove one shard"** (Scope): a second run that claims a lower shard while shard 4 stands half
   removed prints only the merge base's line, and the first run's one line gives a count of 1.
9. **"Highest number first"** (Scope): at the moment the first entry leaves one of three shards to remove, read lowest
   first, no shard has lost an entry while a higher one is not yet gone.
10. **"More than three days"** (Scope) is more than 72 hours by the times of Aging: a shard 74 hours old leaves and
    one 70 hours old stays. The Scope calls the figure drafted; if it moves, this one test goes to a redraft.
11. **"Not in this task"**: the worktree is no shard. Its files and its `target/`, aged four days, are as they were.
12. **Criterion 6**: see below.

## Criteria to tests

The ID is `#3547.<first 8 hex digits of the SHA-256 of the criterion's text, trimmed, white space collapsed>`, as
`scripts/proof-change.mjs` works it out. Each wrong program is the work with a single fault, named so the implementer
can plant it as a twin; the one in bold is its criterion's. I planted each in a throwaway guess (below) and saw the
test fail with the message quoted.

| Criterion | Test (file) | What it holds | Wrong program, and the test's message on it |
|---|---|---|---|
| 1 `#3547.beafe89b` | `sweep.test.mjs`, first | Six shards, none held, 1 to 5 four days old and 6 an hour old. A run that claims two is given shards 1 and 2; afterwards the folder holds 1, 2 and 6 and nothing else of a shard; 1 and 2 hold the worktree's tree; 6 is the folder it was; the worktree and its `target/` are untouched | **`any-age`**: the run removes every shard no live process holds, whatever its age. "afterwards ~/deepbuild-shards holds 2 shards (1, 2), not the 3 it should, shards 1, 2 and 6 ..." |
| 1 `#3547.beafe89b` | `sweep.test.mjs`, second | Scope, "more than three days". Shard 1 an hour old, shard 2 70 hours and shard 3 74 hours, none held. A run that claims one is given shard 1; shard 3 is removed, and shard 2 stays, the folder it was | `one-day`: the run removes each shard last made a tree more than one day before. "shard 2, last made a tree 70 hours before, did not stay as it was, though that is not more than three days: it was removed; ..." |
| 1 `#3547.beafe89b` | `sweep.test.mjs`, third | Scope, "highest number first". Shards 3, 4 and 5 four days old, each with 2,000 folders more. The run is stopped when the first entry leaves one of them: no shard has lost an entry while a higher one still stands. Afterwards the folder holds 1, 2 and 6 | `lowest-first`: the run removes its shards lowest number first. "shard 3 was being removed while shard 4, a higher number, was whole: the run does not remove highest number first; when the first entry left shard 3: shard 3 partly removed (n of its 2043 entries left), shard 4 whole, shard 5 whole" |
| 2 `#3547.da876765` | `locks.test.mjs`, first | Shards 3 and 4 four days old. The run that made them still holds shard 3 and lives through the test. A run that claims one is given shard 1; shard 3 stays, the folder it was, with its lock folder as its holder left it; shard 4, held by no one, is removed in the same run | **`date-alone`**: the run takes no lock and looks at none: it removes each shard four days old. "shard 3, last made a tree four days before, was removed though its lock names a live process (pid n); afterwards ~/deepbuild-shards holds 1, 2, 3.lock" |
| 3 `#3547.0ebc9715` | `locks.test.mjs`, second | The run that made the shards holds shard 2, an hour old, and shard 3, four days old, and is killed. A run that claims one is given shard 1; shard 3 is gone and nothing named from it is left; shard 2 stays as it was, whatever became of its lock | **`leaves-lock`**: the run removes the shard and not the lock it took for it. "shard 3 was removed and its lock folder was left: ~/deepbuild-shards still holds ~/deepbuild-shards/3.lock; ..." |
| 4 `#3547.e7ae7186` | `race.test.mjs`, first | Shards 2 and 3 held by a live run, shard 4 four days old with 5,000 folders more, shard 5 free. A first run claims one and is stopped as the first entry leaves shard 4. A second run, already loaded, then asks for two: it is given two, each holding the worktree's tree; shard 4 only if its line says `made` and nothing of the old folder is in it. The first run goes on and ends: the second's shards are still whole, nothing of the old shard 4 is left, and no lock of shard 4 but the second's own | **`no-lock`**: the run looks whether a live process holds the shard's lock, and removes the shard without holding it. "while the first run was removing shard 4 (shard 4 partly removed (n of its 5043 entries left), with no lock), the second run asked for two shards and was given shard 4 and 5: shard 4's folder as the first run was removing it, not shard 4 made new" |
| 4 `#3547.e7ae7186` | `race.test.mjs`, second | Scope, "two runs never remove one shard". Shards 1 to 3 free, shard 4 as above. The first run is stopped the same way; a second run asks for one, is given a lower shard, and prints only the merge base's line. Then the first run's one line gives a count of 1, and nothing of shard 4 is left | `no-lock` again: "... the second run asked for one shard and was given shard 2, and printed a line the merge base does not print: it removed shard 4, or says it did, while the first run was removing it". Also seen failing both: `unlocks-first`, a run that gives the lock back before it removes |
| 5 `#3547.12729b73` | `line.test.mjs`, first | Eight shards, each with its own weight; 5 to 8 four days old, the rest an hour old. A run that claims two prints exactly one line beyond the merge base's two; it removed 5, 6, 7 and 8; the line holds 4 as a number of its own and the bytes `du` gave for those four | **`all-bytes`**: the line gives the bytes of every shard the run looked at, removed or not. "the run's line does not give the bytes du gave for the shards it removed, 1879408640 bytes (1.88 GB): ... the eight shards together held 5637865472 bytes (5.64 GB): SHARDS 4 removed (8, 7, 6, 5), ...: 4.0 GB by du" |
| 5 `#3547.12729b73` | `line.test.mjs`, second | A run that removes nothing, three times: with no shard yet (one made), with one shard a moment old (one reused, one made), and with shards 1 and 2 an hour old and shard 3 four days old but held by a live run, after which the folder holds what it held. Each prints the merge base's lines and no other, nothing on stderr, and exits 0 | `says-none`: the run prints its line on every run, with a count of 0 when it removed nothing. "with no shard yet, a run that removes nothing does not print the lines the merge base prints, which are: ..." |
| 6 `#3547.4edd3480` | `design.test.mjs` | The comments of `scripts/shards.mjs` and section 7a share a run of at least eight words in a row that names days or hours | **`other-words`**: the script's comment says when a shard leaves, and section 7a says it in words of its own. "section 7a of docs/parallel-proof.md does not say when a shard leaves in the words of a comment of scripts/shards.mjs: ... the longest run they share that does: "three days" (2 words)" |

Seen failing too, each at the first test of `line.test.mjs`: a count of the shards looked at ("does not give the
count of the shards it removed, 4, as a number of its own"), `du`'s kilobytes printed as bytes, the last shard's
bytes alone, `du` read after the removal, and one line a shard ("printed 5 lines beyond ..."). At the second test of
`sweep.test.mjs`: three days and a half ("shard 3, last made a tree 74 hours before and held by no process, is
still there").

The second test of criterion 5 passes on the base, as it must: the base's lines are the ones to hold. The other nine
fail on it. The test of criterion 2 fails there too, at its last assertion: the base removes nothing, so nothing shows
that shard 3 stayed for its lock.

## Criterion 6: how it is held

"Section 7a says when a shard leaves, in the words the script's own comment uses" names words that don't exist yet,
and the wording is the implementer's. Read as loosely as the sentence allows:

- **The script's own comment**: any comment of `scripts/shards.mjs`: each line that starts with `//`, and each line of
  a `/* */` block. A comment that trails code on its line is not read.
- **Section 7a**: `docs/parallel-proof.md` from the heading that starts `7a.` to the next heading.
- **The words**: both texts lowercased, with punctuation, markup and line breaks dropped, share a run of at least
  eight words in a row, and that run holds the word `day`, `days`, `hour` or `hours`: the "when" of a shard that
  leaves. Eight words is what the two texts share today where one repeats the other: on the base their longest
  shared runs are 8 to 10 words ("a folder that is or holds another worktree of the").

It is matched by words, not meaning. On the base the script's comments name no day and no hour.

## On the base

`BASE-FAILURE.txt` holds `node --test tests/acceptance/3547/*.test.mjs` at `2edb19ff4`, on the Mac. Nine tests fail,
each at an assertion and for the expected reason: the base removes no shard. Criterion 1's first test names the count
("holds 6 shards (1, 2, 3, 4, 5, 6), not the 3 it should"); the tests of criterion 4 say that "while one process
removes shard 4" never happened; criterion 5's first test finds no line beyond the base's; criterion 6 finds no shared
words. Criterion 5's second test passes.

To tell a test's fault from a program's, I wrote a throwaway guess at the change in a scratch folder outside the
checkout: `scripts/shards.mjs` with a removal after the claim's locks (lock, age by `.git/packed-refs`, `du -sk`,
remove, give the lock back, one line through `say`) and one sentence added to its comments and to section 7a. It ran
only through a copy of `scripts/` in a temporary folder, with this folder's copy beside it. All 10 tests passed, also
with the removal before the claim, in a later turn of the event loop, by `rm -rf` in a child, with `du` before the
lock, with the folder moved aside first, with the bytes printed whole, and with the age read from the date of the
shard's own commit or from the times of its folder, `.git/HEAD` and its index in place of `.git/packed-refs`. With each single fault named above planted in it, the test named
beside it failed with the message quoted. `BASE-FAILURE.txt` ends with those runs' result lines. The guess is deleted
and proves nothing about the real change.

## What the tests can't see, and what I left out

- **A whole `affected.mjs` run.** No test starts one. That a real run reaches the removal, and that the line reaches
  its output, rests on `affected.mjs` calling `claimShards` with a `say` that prints, as it does on the base.
- **The three days to the minute.** The ages run are an hour, 70 hours, 74 hours and four days: nothing nearer the
  Scope's figure than two hours either side.
- **The Mac's listing before and after one run** (Proof) is a reading of the machine's own shards, which this suite
  never lists. The implementer brings it.
- **A removal with no lock that moves the folder aside in one step.** The second run then sees no folder and makes
  shard 4 new, and the first test of criterion 4 passes. The twin the criterion names removes in place.
- **A remover outside the run's process group**, as a detached child, is not stopped by the test. A removal that
  outlives its run fails criterion 1 instead: the folder is read once the run's process has ended.
- **The bytes at a coarse unit.** A line that prints whole gigabytes passes for any figure within 1 GB of the truth,
  1.88 GB here. Where the disk can't clone, the removed shards weigh 29 MB, and a line in gigabytes says nothing the
  test can check.
- **`du` itself.** The test's figure is `du -sk`. A sum by apparent size, or one that counts the lock folder, is
  inside the 3%.
- **Not in this task, so not run**: the alternates a reused shard keeps (#3515), the bays, and how many shards a run
  takes beyond a run that asks for two being given two.
- **The lock's own shape.** Every lock is taken by the script; a lock with no holder named yet is not set up.
- **Linux.** Drafted and run on macOS (arm64, 18 cores). `ps -A -o pid=,pgid=,stat=`, `du -sk`, `lutimes` and the
  signals work on Linux too, and `cp --reflink=always` stands in for `cp -c`, but nothing ran there.
- **Timers**, each marked `// deadline:`: the limit of a step, the look every 2 ms or 20 ms while a test waits for an
  entry to leave or a process group to stop, and 2 s for a run's pipes to close after its exit. No test waits a fixed
  time for anything.

## Files

- `helpers.mjs`: the sandbox, the run, the shards a test starts from and their aging, a removal stopped half way, the
  weights, and how a line's count and bytes are read.
- `sweep.test.mjs`, `locks.test.mjs`, `race.test.mjs`, `line.test.mjs`, `design.test.mjs`: the tests, by criterion as
  above.
- `BASE-FAILURE.txt`: the run on the base, paths redacted.

No fixture holds a secret or personal data.
