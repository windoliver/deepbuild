# #1888: a claim citing `make lint` through the real hub, by hand

Run by hand on 2026-11-14 on Linux arm64 (node v24.22.0, GNU Make 4.3), at load 60 to 95 on 20 cores. Real `deep hub
run`, the real `deep-hook` binary for every hook, real `deep inbox` and `deep status`. Stand-ins: the agent (a scripted
Claude Code session, whose process is `tests/acceptance/29/fixtures/agent.mjs`) and `eslint` (a shell script on the
session's PATH that exits 1 while `src` holds a `var` line). The
session reads and edits `src/cart.js`, runs `make lint` (exit 0), and stops saying "I replaced `var` with `const` in
the cart module. I ran `make lint` and it reports no problems." A locked definition for the prompt's task is handed to
the hub through its `DEEP_HUB_TEST_DRAFTS` seam; without one the validity gate has nothing to read the claim against.

The two fixtures differ only in the Makefile: `test lint:` running `eslint . || true` (masked), and running `eslint .`
(clean).

| Tree | Makefile | What Claude Code gets back from the Stop hook | Record after `claim.made` |
|---|---|---|---|
| this branch, dfdf9910d | masked | `{"decision":"block","reason":"says done · next: DeepBuild · session/f2e6cc5b/01M7EB5YRAW35GQNP59BSKY3EG\nDeepBuild sent this claim back before any check ran:\n- the run `make lint` it cites proves nothing: exit status masked by `\|\| true`","systemMessage":"says done · next: DeepBuild · session/f2e6cc5b/01M7EB5YRAW35GQNP59BSKY3EG"}` | `claim.progress`, `claim.sized`, `stop.held`: no run, no verdict |
| this branch, dfdf9910d | clean | `{"systemMessage":"not verified: R1 · INVALID 0/1 · next: agent"}` | `run.started`, `run.finished`, `verdict.made` (INVALID), `stop.held` |
| base reader, 6ead59fe9 | masked | `{"systemMessage":"not verified: R1 · INVALID 0/1 · next: agent"}` | `run.started`, `run.finished`, `verdict.made` (INVALID), `stop.held` |

`packages/gate` is the same at 6ead59fe9 and at the merge base 72fe11a11. The base tree ran outside the worktree, from
`git archive` with its own build.

What this shows, and what it doesn't:

- On this branch the masked claim is sent back before any check runs, naming the run and its mask. On the base the
  same claim goes on to its check as if the run proved something.
- The validity gate's send-back writes no receipt and no `claim.sent_back` event, on either tree: the reply and the
  absence of a run are what the record holds.
- The clean twin's INVALID is the fixture's own: its drafted check has no run on the merge base. The claim passing the
  validity gate is what the run shows; reaching PASS was not exercised.
- `make test`, the rule's other target, was read through the floor (`tests/acceptance/1888/reads.test.ts`), not
  through the hub.
- One base run of the clean twin lost its SessionStart hook under load (deep-hook's 50 ms spool limit) and was run
  again; that first run is INCONCLUSIVE and isn't in the table.
