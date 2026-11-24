# Acceptance tests for #3245: a configuration eval's judge grades the change, not what the agent said of it

Written first, blind, from issue #3245 (its text as of November 23, 2026: the opening, Scope, the eight acceptance
criteria, Proof and Depends on #112), the design it links (`docs/technical-design.md`: The learned layer; How we know
version 0 works, Configuration evals; Claim; Check), `AGENTS.md`, the suites `tests/acceptance/112`, `2077`, `2495`,
`1108` and, for shape, `3218`, and the base commit `a5fc47436`: `packages/config-eval/src`, `packages/record/src/replay.ts`,
`scripts/config-eval.mjs` and `packages/hub/src/hub-runtime.ts`. The job never saw an implementation. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

## How to run

```sh
npm ci                                  # once, if node_modules is missing
npm run build --workspaces              # kinds.test.ts runs scripts/config-eval.mjs plan, which loads the packages' dist/
node node_modules/vitest/vitest.mjs run tests/acceptance/3245
node node_modules/typescript/bin/tsc -p tests/acceptance/3245/tsconfig.json
```

Nothing calls a model, the network or a sign-in, and nothing needs a hub. The eval (`runEval`), the comparison
(`compareReplay`, `planHash`), the archive reader, both plan makers (`node scripts/config-eval.mjs plan` and
`removalPlan`), the record and the evidence store are the repo's own. Only the agents and the judge are scripted, through
`EvalOptions.launcher`. The only processes started are `git` in temp folders and the plan script, each awaited. Temp
folders are `dh3245-*` under the system temp folder, removed after each file, the plan script's HOME among them.
`GIT_DIR`, `GIT_WORK_TREE` and the like are taken out of the environment first. Nothing is timed.

## The surface under test

The issue names behavior and no code API. These are the smallest names that reach every criterion, each an optional
addition, so a plan or report an earlier eval kept as evidence still reads, and `planHash` of a plan without the new
field is what it was (`packages/record/test/replay-hash.test.ts`).

In `packages/record/src/replay.ts`:

```ts
export interface ReplayPlan {
  // ...as at the base, and:
  /** The named tasks, deciding and fitted, that are graded on words: each one's original session changed no file. */
  words?: string[];
}
```

- Absent or empty: no task is graded on words, so every task the plan names is a work task, and no reply is shown.
- Both plan makers write it: the IDs, among `tasks` and `fitted`, of the tasks whose original session changed no file. With
  none they may leave it out or write `[]`. Its order isn't tested.
- It is a field of the plan like any other, so `planHash` covers it.
- `runEval` reads a task's kind from the plan alone. How `archivedTasks` hands the kind to the plan makers (an optional
  field of `ReplayTask`, say) is the implementer's.

In `packages/config-eval/src/index.ts`:

```ts
export interface EvalReport {
  // ...as at the base, and:
  /** The plan's tasks, deciding and fitted, that were graded on words. */
  words?: string[];
  /** Each run whose output doesn't fit the cap: its size and the cap, in characters. Its grade is missing. */
  oversize?: { task: string; side: 'base' | 'change'; repeat: number; size: number; cap: number }[];
  /** The eval's first judge request as it was sent, and its scores of the right change and of no change; null is no score. */
  control?: { request: JudgeRequest; right: number | null; none: number | null };
}
```

- `words` absent or empty: no task was graded on words. Its order isn't tested.
- `oversize` absent or empty: every output fit.
- `control` absent: no control was sent. That is a report kept before this change, an eval refused before any judge was
  asked, or an eval whose plan declares no `grade` measure, which sends its judge nothing, as on the base. An eval refused
  by its control has it.

Nothing else is new: `runEval`, `JudgeRequest`, `Grade`, `Launcher`, `archivedTasks` and `removalPlan` keep their
signatures.

## Readings where the issue leaves a choice

- **A change is shown as `git diff` prints it**, as at the base, and a work task's output is that text and nothing else.
  Its size is the number of characters of that text.
- **"A run whose change is 30,000 characters."** The agent writes one new file, `src/prices.js`, sized so that
  `git diff --cached --no-color --no-ext-diff <the commit the run started from>` in its checkout, after `git add -A`,
  prints exactly 30,000 characters (ASCII, one file, the last newline among them). The test measures that diff and checks
  the length first. So the text a right program would have shown the judge is 30,000 characters, and its report reads
  `size: 30000, cap: 20000`. A second run's change is exactly 20,000 characters: it fits, and is sent whole.
- **The cap is the base's**, 20,000 characters of an output's text, and it holds for a reply where the reply is the output.
- **Whether the base side of a pair whose change side is past the cap is graded** isn't tested. The pair stays in `n`, and
  the measure has no mean and no bound.
- **"No change"** is any text with no line of a git diff in it: no line that starts `diff --git `, `@@ ` or `+`. The words
  for it, or an empty text, are the implementer's. So the tests, and the judge stub, tell a change from no change by one
  rule: a change has such a line.
- **The judge's prompt says the outputs are changes**: a work task's prompt, the task's own words taken out, holds the word
  "change" or "changes". Nothing else of any prompt's wording is tested, but that a task's request holds the task's
  own words, as at the base.
- **The control.** It is the one request whose prompt holds no task's words, which is how the judge stub knows it, whenever
  it comes. The tests then require that it is the eval's first judge request, that no agent started before it, that it has
  two outputs of which one shows a change and the other none, that it goes to the plan's judge under the labels any other
  request of two outputs has, and that its prompt and its two outputs are the same in every eval ("the package ships one
  request with two outputs, kept by hash"). The order of the two outputs, and so which label is whose, is free. The stub
  scores the output that shows a change as `right` and the other as `none`.
- **Refused** is `after.outcome: 'refused'` with no runs, as a refused eval is at the base. The reason holds the judge's
  model name and each score it gave. A judge that throws, leaves a label out or gives a score that is no number gave no
  score. 0.5 is refused and 0.49 isn't; a right change must score above no change.
- **A kind is read from the original session's own tool calls** in its archived transcript. The archive here holds three
  sessions of each of eight kinds, each shaped as Claude Code 2.1.308 writes one (`adapters/corpus/claude-code/2.1.308`):

  | Session | Its tool calls | Kind |
  |---|---|---|
  | `edit` | Read, then an Edit that went through | work |
  | `write` | a Write that made a file | work |
  | `heredoc` | Bash `cat > src/x.js <<'EOF' ...` | work |
  | `sed` | Bash `sed -i '' ... src/cart.js` | work |
  | `read` | Read and Grep | words |
  | `failed` | one Edit whose tool_result has `is_error: true`, and nothing else | words |
  | `tests` | Bash `npm test 2>&1 \| tail -20` and `git log --oneline -5` | words |
  | `none` | none | words |

  Other shell commands, a subagent's calls and files outside the repo aren't tested.
- **"A planted plan ... fails, naming the task"** is the planted wrong program: the plan the plan maker made, over the task
  and one work task, with the task's mark taken out of `words`. The eval follows it, so its judge is shown no change on
  both sides, and the check that a task graded on words shows its replies fails, naming the task.
- **The output of a task graded on words** holds each run's whole reply, and no line of a file that run wrote.

## The planted wrong programs

Each is the real `runEval` with one thing done wrong between it and its judge (`helpers.ts`): `showsTheReply` puts each
run's final reply over its change, as the base does, and `controlsLast` lets its agents start on a control it answers
itself and sends the control after them. The planted plan is above. Each is checked in its criterion's own test, after
the right program's part, so a test whose program is wrong never gets that far.

## Criteria to tests

| ID | Criterion (short) | Test | A wrong program, and how it fails |
|---|---|---|---|
| AC1 `#3245.8d415edc` | the same change on both sides, "Done. All tests pass" in the change side's replies: outputs equal byte for byte, INCONCLUSIVE | `judged.test.ts` AC1 | the base: `adopt`, all six pairs' outputs differ; an eval that shows the judge nothing has no grades |
| AC2 `#3245.89bedf9f` | a marker in a reply is in no output of a work task, in any request; a planted eval that shows the reply fails, naming the request | `judged.test.ts` AC2 | the base: each request shows it; `showsTheReply` the same; one that shows a commit's message shows its marker |
| AC3 `#3245.f49a2718` | a run that changed nothing and said it was done is shown as no change, without the reply | `judged.test.ts` AC3 | the base shows the reply over `(none)`; one that leaves the run out shows one output |
| AC4 `#3245.03f250e0` | a task whose session changed no file shows its replies, listed as graded on words; a planted plan fails, naming the task | `kinds.test.ts` AC4 | the base's plans mark none; one that reads only Edit and Write, counts a failed Edit, or reads `2>&1` as a file marks the wrong ones |
| AC5 `#3245.ee666719` | a 30,000-character change: no grade, its size and the cap in the report, INCONCLUSIVE naming the task | `judged.test.ts` AC5 | the base grades its first 20,000; one that caps replies only, or cuts, or refuses 20,000 exactly |
| AC6 `#3245.e9a302e8` | no change at 0.9 refuses before any agent; 0.1 and 0.9 goes on with the control in the report; a planted eval that runs the control after the agents fails, naming the first agent run | `control.test.ts` AC6 | the base sends no control; `controlsLast`; one that passes 0.5, a tie, or a missing score |
| AC7 `#3245.3e193e65` | a task marked the other way after either side ran is refused | `kinds.test.ts` AC7 | the base's plans hold no marks; a hash that leaves `words` out |
| AC8 `#3245.fb376f22` | the control adds one judge request and no agent run | `control.test.ts` AC8 | the base sends 6 judge requests for 12 agent runs; a control per task, a control for a plan with no `grade`, or a control that takes an agent |

AC8's budget is a count, so it reads anywhere. The base's counts are of the same scripted eval, six tasks of one repeat a
side, run on `a5fc47436`: 6 judge requests and 12 agent runs, and 0 judge requests for a plan that measures tokens alone.

Not tested: a hub, the real launcher, any agent or judge, and that the package keeps its control by a hash (only that every
eval sends the same one).

### Checked against a throwaway right program

The suite was run against a right program built in a copy of this checkout outside it (in the session's scratch folder,
unpacked with `git archive`, no `.git` in it) and deleted afterwards; it was never in the repo. All 8 tests passed on it,
and each of these 45 mutants of it failed the test named, at the assertion that names what it does:

- **AC1**: a prompt that says nothing of changes; one that shows no output of a work task (no grade, not a gain of 0).
- **AC2**: one that shows the run's commit messages.
- **AC3**: one that shows the reply where nothing changed; one that leaves the run that changed nothing out; one that reads
  an absent `words` as every task graded on words.
- **AC5**: one that cuts at the cap and grades it; one that sends it cut and drops its grade; one that refuses exactly
  20,000; one that names no size, or a wrong one; one that caps changes and not replies; one that counts the run as failed.
- **AC6**: no control; one that passes no change at 0.5, at a tie, above the right change, with no score for no change, or
  with no score for the right change; one that a failing judge ends with an error; one that refuses no change at 0.49; a
  reason without the judge, without the right change's score, or without no change's; the control kept out of a refused
  report, or out of a report; a control labelled by what it is, made of the eval's own plan, made of a task's words, of
  three outputs, or asked for after the agents.
- **AC8**: a control for a plan with no `grade`; a control asked for twice.
- **AC4**: a kind read from Edit and Write alone; a failed edit counted; `2>&1` counted as a file; `sed -i` read as no change;
  a Read counted; the script's plan marking no fitted task; `removalPlan` marking nothing; a kind read from the tasks whatever
  the plan says; a words task shown its reply and its changes; a report that lists none.
- **AC7**: a kind kept on the tasks alone; a hash that leaves `words` out.

Each mutant was run on the test named alone.
