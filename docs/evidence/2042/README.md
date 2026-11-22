# #2042 hand e2e: hook payloads deep-hook can't read, hub stopped and running

`run.sh` builds a temp HOME at `/tmp/e2e-2042` with the shipped `crates/deep-hook/default-rules.json` (its
fail_closed entries installed), writes the payloads of `payloads.py`, and pipes each into the real built
`target/debug/deep-hook claude-code PreToolUse`: first with no hub, then with a dev hub (`deep hub run` from
`packages/cli/dist`) that it starts, and stops by the PID it started. Exit 2 is a denial, 0 a call let through.

- `e2e-hub-stopped-and-running.png`: one run in a Terminal window on 2026-11-21, title bar cropped. Its header names the
  HEAD it ran at and the last commit that touched code outside `docs/` (d1a6f4879, the fix): `deep-hook` and the dist
  were built from that code. On screen each line is cut at 151 characters; an agent checked it: no error, every row
  as expected.
- `e2e-full.txt`: the same run, written by `run.sh` through `tee`, with each denial whole.

What it shows: payloads 01–07 (nested inside 300 arrays, cut to 40 bytes, empty, not JSON, not UTF-8, the first
1 MiB of a call just over 2 MiB, `1e999`) are each denied with the same words naming the payload and why, with the hub stopped and running.
`ls`, and `ls` with a lone `\ud800`, run both ways. `git push origin main` with a lone `\ud800` is decided as the plain
push is: let through with the hub away (no shipped fail_closed entry holds a readable push then), and held by the
hub's push-needs-ask with it running, both waiting on the same ask, so the hub read the same call.

Reproduce: `npm run build --workspaces`, `cargo build -p deep-hook`, then `bash docs/evidence/2042/run.sh`
(Node 24 under `~/.nvm/versions/node/v24.22.0`).
