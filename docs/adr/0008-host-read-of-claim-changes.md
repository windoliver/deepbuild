# 0008: What a claim on a host changed

Status: accepted (#3511). The design states the rule under Whose checks count; the decisions below are the ones written nowhere else.

## Where it is read

- **The hub reads the session's folder on its host over SSH, before the check's run starts there.** `packages/hub/src/host-gate.ts`, `stopOnHost`. The run is in the same folder, and what it writes there is not the claim's change. Until the read ends the check stands as running, so no verdict reads the claim as having changed nothing.
- **A failed read, a link that didn't answer, a read past its deadline and a hub with no host read are a change set that couldn't be read.** `packages/hub/src/host-sessions.ts`, `HostSessions.changes`; `host-gate.ts`, `stopOnHost`. Each is the change set's `unread`, naming which, so every approved check counts as the agent's own. The deadline is the one `changesOf` gets (#1869).
- **A run on a host records no read files, so every changed file counts as read.** `packages/gate/src/own.ts`, `ownChanges`, with a `read` of null. What isn't known never reads as not read. The reason names that the check "may load" the file.

## What the read trusts

The script is `CHANGES` in `packages/hub/src/host-sessions.ts`, run by the host's shell.

- **A file that can be a check's own by its name alone is compared by its bytes, not by git's diff.** `OWN_BY_NAME` in `packages/gate/src/own.ts` names those paths, as an extended regular expression: under the test, fixture and script folders, a file the test tool loads by its name, and package.json. Each one the commit holds is hashed as it lies in the folder, with no filter, attribute, index or file time between, and compared with the commit's tree. A file of the same kind and execute bit is hashed, a link's text is hashed, and anything else is changed. The other files are git's own diff.
- **The commit and every tree the read walks are packed and named again from their bytes, and the read takes its trees from that pack alone.** An object the folder's own store forged has another name. No other copy git finds, in an older pack or by a forged commit graph, can stand in.
- **Git runs with the folder's `GIT_*` environment cleared, replace objects, the commit graph and case folding off, and C's locale.** Each of these let an edited or added test file read as the base's.
- **A repo whose top isn't the folder's, or a `.git` between the two, is a failed read.** Git there would read another work tree than the session's.
- **Any step that fails ends the read with no `read` line**, by `set -e`, and a failed encoding of a list is a failed read: a short list never reads as no change.
- **What the script prints is base64, each list on a line of its own**, so no path can forge a line.

## What the agent controls there (#3584, #3589, folded into #3511)

- **The read runs as `/bin/sh -s`, with the system's PATH and no libraries set to load first.** `packages/hub/src/hosts.ts`, `sshScript`; `CHANGES`. A login file the agent can write sets PATH and LD_PRELOAD; a `git` or `sh` it puts first is never the one the read runs, and a read with LD_PRELOAD, LD_LIBRARY_PATH or LD_AUDIT set is a failed read. A login file that prints its own `read` line in place of the script's is not caught: ssh runs the login shell before `/bin/sh`, and nothing the hub sends can run first.
- **The session's repo top is read once, at its first hook, and a read whose git takes another top is a failed read.** `packages/hub/src/session-state.ts`, `sessionTops`; `HostSessions.topOf`. A hub that restarts reads the top again at the session's next hook.
- **An ignored file whose path is own by name counts as changed.** The ignore rules are the agent's. A cache the check's tool writes under a test folder, such as `tests/__pycache__`, then makes the check the agent's own unless the repo's own run leaves it as the next point says.
- **An untracked own file a check of an earlier claim on the same folder wrote is not this claim's change while its bytes are the same.** `packages/hub/src/host-gate.ts`, `stopOnHost`: the hub reads the folder again after each run, and keeps the hash of each untracked own file that appeared or changed (`Claim.written`).
- **A tracked own file that changes between the read and the run's end makes the read a failed one.** The same read after the run compares its bytes and its change time and inode (`stat %z %i`), so an edit put back before the second read still shows. A check whose run rewrites its own tracked files fails the same way.
- **Open, for the owner:** an untracked own file written while a run went is taken for the run's output and kept in `Claim.written`. A process the agent leaves can plant one, such as `tests/conftest.py`, and every later claim on the folder then runs with it. That is a full bypass, not a one-claim gap. Criterion 9 (a run's log passes) and criterion 4 (a process's write fails) can't both hold when nothing tells the two writers apart.
- **Open:** criterion 5's login file that prints a clean `read` can't be closed by any read run as the host's user, since that user is the agent's: the login shell runs first and can read the script on stdin. The LD_* refusal catches only a library that leaves its variable set.
- **A Makefile or justfile at any depth counts as a script the check runs, at the file level.** `packages/gate/src/own.ts`, `ownChanges`. Which target a check's command reaches isn't parsed.
- **Locally, `changesOf` compares own files by their bytes too, lists ignored own files, and fails a read whose git takes another work tree.** `packages/hub/src/claim-changes.ts`.
