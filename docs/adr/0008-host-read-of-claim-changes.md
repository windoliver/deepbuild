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

## Open

Filed as #3584 and #3589: an ignore rule the agent controls, the host user's own shell and git config, which the agent can write, and a session started in a subfolder of its repo.
