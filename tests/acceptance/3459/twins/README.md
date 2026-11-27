# Twins for the 3459 tests

No implementation existed when these tests were drafted, so no twin folder is here yet. Each twin is the merged
implementation with exactly one rule broken as below, and nothing else changed: in particular each still writes the
command's last line naming the kept folder, and still makes the durable point `restore_aside` (`../README.md`, The
staged cut). A twin changes product files only, never a file under `tests/`, and is kept as its wrong lines in
`twins/<name>/lines.json` (the line form, `tests/acceptance/1832/README.md`), never as a whole copy of a file.
"Replaces" names the file its lines most likely change, as the base has it; the implementer names the real ones.

| Criterion | Twin | Replaces | The one rule it breaks | Test it fails, and where |
|---|---|---|---|---|
| `#3459.28771dde` | `sentence-names-folders-only` | `packages/hub/src/backup.ts` (the words handed to `confirmer.you`) | The sentence the OS is shown is the merge base's: "restore DeepBuild's record from `<folder>`, replacing the one in `<dir>`". It names the two folders and nothing the restore would take away, for an earlier copy and for another record's backup alike | Both tests of `sentence.test.ts`, at `left out`: the first lists `the 40 events the record holds past the backup's last` and `the newest one's time (…)`; the second `that this record is not the one the backup was taken from` and `how many events this record holds (<n>)` |
| `#3459.cd3c8ee1` | `keep-copies` | `packages/hub/src/backup.ts` (where the replaced ledger, `evidence/` and `wiki/` go to the kept folder) | The keep copies: the kept folder's files are new files with the replaced ones' bytes (the ledger copied, the folders through `copySynced`), and the originals are then removed. Hashes are equal; inodes aren't | `kept.test.ts`, the inode test's last assertion: `<kept>/<file> has inode <n>; before the restore the file had inode <m>: it was copied, not moved`, one line per file, each named |
| `#3459.a9ca2cbc` | `swap-deletes-before-move` | `packages/hub/src/backup.ts` and, if the ledger's move lives there, `packages/record/src/index.ts` (`put`) | The swap removes the replaced `ledger.db` from its place before it moves anything aside, as the merge base's `put` renames over it: the kept folder gets `evidence/` and `wiki/` and no ledger. The point `restore_aside` is still made, and the cut still comes | `cut.test.ts`, right after the cut: `after the cut, the kept ledger is in no folder under <root>: the replaced ledger.db (inode <n>, <k> events, the newest <event>) was deleted, not moved aside` |
| `#3459.e4e3976d` | `second-restore-unsaid` | `packages/hub/src/backup.ts` (the sentence, where a kept folder is already there) | A restore that finds a kept folder replaces it and says nothing of it: its sentence is the one shown when no folder is kept | `second.test.ts`: `the second restore would replace the kept folder <kept> unsaid: its sentence is the one shown when no folder is kept, "<sentence>"` |

`#3459.6fc3983f`, `#3459.b8f5554f` and `#3459.4a7ca7c9` have no twin: the wrong program the issue names for the first is
the merge base, which keeps nothing, and all three fail there for want of a kept folder (`../BASE-FAILURE.txt`).

The merge base is itself `sentence-names-folders-only` and fails both sentence tests at those assertions. The other
three can only exist on the change: the merge base has no kept folder, no point to cut after and no second sentence,
and fails their tests earlier. None of the four was planted when these tests were drafted, since that takes an
implementation; the assertions they must fail at were reached only by a kept folder made by hand (`../BASE-FAILURE.txt`).
