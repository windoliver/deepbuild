# #2042 hand e2e: hook payloads deep-hook can't read, hub stopped and running

`run.sh` builds a temp HOME at `/tmp/e2e-2042` with the shipped `crates/deep-hook/default-rules.json` (its
fail_closed entries installed), writes the payloads of `payloads.py`, and pipes each into the real built
`target/debug/deep-hook claude-code PreToolUse`: first with no hub, then with a dev hub (`deep hub run` from
`packages/cli/dist`) that it starts, and stops by the PID it started. Exit 2 is a denial, 0 a call let through.

- `e2e-hub-stopped-and-running.png`: the run in a Terminal window on 2026-11-20 at 93def2016 (the fix), title bar
  cropped. Its lines are cut at 118 characters on purpose; an agent checked it: no error, every row as expected.
- `e2e-full.txt`: the same run at the merge of main 6395f3cfc, with each denial whole.

What it shows: payloads 01–07 (nested inside 300 arrays, cut to 40 bytes, empty, not JSON, not UTF-8, 2 MiB cut
short, `1e999`) are each denied with the same words naming the payload and why, with the hub stopped and running.
`ls`, and `ls` with a lone `\ud800`, run both ways. `git push origin main` with a lone `\ud800` is decided as the plain
push is: let through with the hub away (no shipped fail_closed entry holds a readable push then), and held by the
hub's push-needs-ask with it running, both waiting on the same ask, so the hub read the same call.

Reproduce: `npm run build --workspaces`, `cargo build -p deep-hook`, then `bash docs/evidence/2042/run.sh`
(Node 24 under `~/.nvm/versions/node/v24.22.0`).
