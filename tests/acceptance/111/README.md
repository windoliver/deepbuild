# Acceptance tests for #111: every agent's memory compiled into the wiki, with lessons to keep or remove

Written first, blind, by a job that never saw an implementation of #111 (none exists). It read:

- issue #111 (Scope, 4 criteria, Proof), and #355, #356, #62 for scope boundaries only
- `docs/technical-design.md`: The learned layer, Reading by reference, Decision and rule, What a session loads, the `wiki`, `resolver-decisions` and `view` rows, line 29 (the keep-or-remove list, taste), Dogfooding
- `AGENTS.md`; the suites of #355, #356, #62, #26, #316, #327
- public entries: `@deepbuild/wiki`, `@deepbuild/resolver-decisions`, `packages/hub/src/setup.ts`, `wiki-build.ts`, `tools.ts`, `packages/cli/src/main.ts`; `scripts/proof-change.mjs` for the tag format
- base commit `244a3455`

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## How to run

```sh
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$HOME/.cargo/bin:$PATH
npm ci; npm run build --workspaces
cargo build --locked -q -p deep-hook
node node_modules/vitest/vitest.mjs run --root tests/acceptance/111 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/111/tsconfig.json
```

Folders are temp folders under `/tmp` made by the imported helpers, HOME is a temp folder for every child. No network and no model call: `claude` on the login PATH is #356's fake reader, `launchctl` its launchd stand-in. Processes are stopped by PID only. `--no-file-parallelism`: every file starts real hubs, so the implementer adds this folder to `scripts/lanes.mjs`'s one-at-a-time list. macOS only (launchd stand-in); elsewhere BLOCKED, never a pass.

## The surface under test

Merged surfaces, used as they are:

1. **`deep setup`** in a temp HOME (#19, #356): the compile runs inside it, as #356's `wiki.build` does. The tests wait for its reading jobs.
2. **The wiki** at `~/.deepbuild/wiki/`, claim lines in #355's format (`- <text> <!-- deep:claim {"id","known","proof","sources"} -->`), and `rules.md` for your rules.
3. **`deep read <handle>`**, **`deep inbox`**, **`deep inbox answer`**, `events.read` and `ask.answer` on the hub socket (`ask.answer`'s `image`, #327).
4. **`deep_ask`, `deep_evidence`, `deep_propose`** from #26's agent stand-in, and **SessionStart / UserPromptSubmit** hook replies through it.
5. **deep-hook** run as an agent's hook entry runs it, for PreToolUse decisions, so a stop may live in the hub or in `rules.json`.
6. The **OS confirmation** stub (`DEEP_HUB_TEST_CONFIRM`, #24): `confirmed`, or anything else to refuse.

### Invented here: exactly what the implementer must supply

Nothing in the issue or the design names these. Each is the plainest reading found; a reasonable other reading is a redraft request.

1. **`deep memory --json`** prints `{"lessons":[{"id","kind","text","rank","sources":[{…,"quote"}]}]}`, in rank order, `rank` 1..n, `kind` one of `guard`, `shared-rule`, `removal`. Why: the issue's "ranked keep-or-remove list" has no named surface. Plain `deep memory` for people is not tested.
2. **`deep memory keep <id>`** and **`deep memory remove <id>`** act once the OS confirms you, exit non-zero when it doesn't, save one `decision.created` by the core, and take the lesson off the list. Why: "for you to keep or remove", and a keep is a decision (invariant 3).
3. **Where pi and Cursor keep files**, since no merged surface reads them:
   - pi: `~/.pi/agent/AGENTS.md`; transcripts `~/.pi/agent/sessions/--<path>--/<time>_<id>.jsonl` (a `session` header with `cwd`, then `message` entries, `message.role`, `message.content[].text`).
   - Cursor: `~/.cursor/rules/*.mdc` (front matter, then bullets); transcripts `~/.cursor/projects/<folder>/agent-transcripts/<id>.jsonl` (`role`, `message.content[].text`). The `cwd` isn't in these lines, so no test pins the page a Cursor claim lands on.
   - Claude Code and Codex are as #356 read them.
4. **`rejected: <direction>.` in your own message** is a decision made in chat, as `remember: <fact>.` is a fact (#356). A direction is an exact key in backticks (`` rejected: `graphql`. ``). Saved as one `decision.created` by the core with `scope` `repo:<project>`, its data holding the key. Why: the design says keys are exact and pattern matching goes first; the fake reader finds only `remember:`, so this must be matched without it.
5. **A stop is**: `deep_propose` whose `change` holds the key in backticks, in the decision's repo, returned as a tool error (`isError`) whose value holds `decision:<id>`, with no ask raised; and a PreToolUse whose Bash command has the key as a whole word, denied, the denial holding `decision:<id>`. `graphql-tools` is another key.
6. **The option you passed over is a rejected direction**: answering a choice whose other option's label has a key in backticks stops that key the same way, citing the decision the answer saved. The chosen option's key is not stopped.
7. **Which screen a session starts on** is read from the worktree's branch name or the first prompt's words, since a SessionStart payload names no screen. The fixtures state it both ways, and `delivered` is the SessionStart reply plus the first UserPromptSubmit reply, so either route passes. Delivery names what you chose (its option label) and the screenshot's SHA-256.
8. **A kept guard**: `Never run \`<command>\`` in a memory file is a `guard` lesson; only kept does deep-hook deny that command. Its twin still runs.
9. **A removal**: a memory line whose backticked path isn't in its repo is a `removal` lesson. Removing it takes the line off every page, for good. No test asserts what happens to the agent's own memory file.
10. **Ranking**: among shared rules, more sources first. Nothing else about the order is pinned.
11. **The perf task**: `benchmarks/budgets.json` holds a task whose `initialReason` names `#111`. Its command is the implementer's.

## Readings where the issue leaves a choice

- **"A rule repeated"**: the same words on a bullet line, whichever bullet mark. Case or punctuation differences are not tested as a repeat. A rule that differs by a word stays its own claim (the wrong program merges them).
- **A source names a file** by its path or the SHA-256 of its bytes (`record.keep`'s handle).
- **`known`** of an agent's project memory line is anything but `you` or `decision`. User-level files' `known` is not pinned.
- **"Real memory files"** in the Proof: `fixtures/memory/` has real shapes (headings, prose, front matter), made-up content.
- **Credentials**: #356's canaries in every agent's file; the sweep is #356's, of everything under `~/.deepbuild` but `evidence/` and `jobs/`, plus the list's output.
- **60 s** counts only on a reference Mac in a fit state (#356's gate), and a corpus of 200 rules per agent (a large real set); elsewhere INCONCLUSIVE with the reading. That the compile read every agent is judged anywhere.

## Criteria to tests to wrong programs

| ID | Criterion (short) | Tests | Wrong programs it fails |
|---|---|---|---|
| `#111.fe2b4a16` | one shared rule with both sources | `compile.test.ts` | the base (first file wins, second source lost); keeps two claims; merges "every push" into "every commit"; adds a source each re-read; a source that doesn't resolve |
| `#111.ddf55f68` | reviving is stopped, decision cited | `revive.test.ts` | a stop with no handle; asks you again; takes an agent's word as a decision; stops other directions, longer names or other repos; only a saved answer or only chat stops; never stops a tool call |
| `#111.536dfc0e` | taste decisions with screenshots at start | `taste.test.ts` | no screenshot; another screen's or another repo's; the option passed over; all of a repo's |
| `#111.5691aa30` | under 60 s, against the merge base | `budgets.test.ts` | reads only some agents quickly; no perf task |
| Scope, Proof | four agents, transcripts, ranked list, keep and remove | `compile.test.ts`, `lessons.test.ts` | pi or Cursor unread; assistant's words as yours; a list unranked or unsourced; a guard live before it's kept, or dead after; a removal that comes back; keep or remove with no confirmation, or by a proposal |

## Files

`helpers.ts` (over #356's, #26's and #316's helpers, imported, as #355 imports #26's), `fixtures/memory/`, `compile`, `lessons`, `revive`, `taste` and `budgets` `.test.ts`, `tsconfig.json`, `BASE-FAILURE.txt`.

## Not done, and weak spots

- **A tension with #62 the implementer must settle.** At the base a user-level memory line is refused by the learned layer ("was learned at install from no session of a known repo"), so `rules.md` stays empty even with history. These tests need those rules on `rules.md` with `proof` the number of files. If that can't be had without weakening #62's rule, it's a redraft request or a question for the owner, not an edit here.
- **No sample fix was run.** No criterion test has passed on any program, so some may be unpassable for a reason the base can't show. The first implementer to meet one reports it as a redraft request and doesn't edit the tests.
- `deep memory keep` from inside an agent's process tree is not run: the stand-in has no shell op. The test covers a refused confirmation and a `deep_propose`.
- A taste decision taken by a default isn't told apart from yours; a revoked decision that should stop stopping isn't tested.
- A rejected direction raised through `deep_ask` isn't tested: same-key asks are #23's, and an ask's free wording has no key.
- Planted twins (`twins.json`) are the implementer's to add where the before lane needs them.
