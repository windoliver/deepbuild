# Acceptance tests for #112: configuration evals replay real past tasks before a change lands

Written first, blind, from issue #112 (its text as of October 28, 2026: Scope, the eight acceptance criteria, Proof and
Depends on #20, #63, #62; it has no comments), the design sections it rests on (The learned layer, Reading by
reference, One event log with tables built from it, Extension API, Plan usage per account and per task, Numbers
version 0 has to hold, and How we know version 0 works, with its Agent evaluation, Dogfooding and Where each layer
runs, all in `docs/technical-design.md`), `AGENTS.md`, the suites of the issues it depends on or sits beside
(`tests/acceptance/20`, `62`, `63`, `723`, `724`), and base commit `8ae1587` (main), by a job that never saw an
implementation of #112. #113 and #118 share #112's comparison rule; their bodies were not read. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

Run them:

```sh
npm ci                                  # once, if node_modules is missing
npm run build --workspaces              # the packages export dist/; run it twice after a fresh install
node node_modules/vitest/vitest.mjs run tests/acceptance/112
node node_modules/typescript/bin/tsc -p tests/acceptance/112/tsconfig.json   # type check
```

Nothing calls a model, spends plan usage, needs the network or a sign-in. The agents under test and the judge are a
boundary this repo doesn't own, so every fast test stands them in with a scripted fake `Launcher` (below). The two live
tests (`live.test.ts`) run only with `DEEP_EVAL_LIVE=1` and an input file; without them they skip with the reason and
never pass. Temp folders are under the system temp folder (`dh112-*`) and removed after each file; nothing is killed.

## The surface under test

The issue names a replay, a frozen plan, a comparison rule, a blind judge, a cutoff, a hold and the learned layer's
widening, but no code API. The eval is an extension (the issue is `area:extension`) and the core never imports an
extension, so the surface is in two places. Names here are this job's.

### The comparison rule, in the core: `packages/record/src/index.ts`

```ts
export interface Measure { name: string; better: 'higher' | 'lower' }
export interface Variant { name: string; files: Record<string, string> }   // files written over the checkout: path → text
export interface ReplayPlan {
  id: string;
  cutoff: number;                  // ms since the epoch: the change was learned from sessions before it
  tasks: string[];                 // the replayed tasks that decide: each from after the cutoff
  fitted: string[];                // tasks from before the cutoff, replayed as a reading; may be empty
  variants: { base: Variant; change: Variant };
  models: { agent: string; judge: string };
  repeats: number;
  measures: Measure[];             // every declared measure
  rule: 'paired-mean-one-sided-95';
  budget: { ms: number; plan_share: number };   // its stated time, and share of one 5-hour plan window (0 to 1)
}
export interface ReplayRun {
  plan: string;                    // planHash of the plan this run ran under
  task: string;
  side: 'base' | 'change';
  repeat: number;                  // 1 to plan.repeats
  ok: boolean;                     // false: this side failed this repeat (crashed, timed out, stopped with no result)
  metrics: Record<string, number | null>;   // each declared measure; null when missing, never 0 for a missing one
}
export interface ReplayResult { plan: ReplayPlan; runs: ReplayRun[] }
export interface MeasureResult {
  name: string; better: 'higher' | 'lower';
  mean: number | null;             // the mean gain over the tasks compared (positive: the change is better)
  bound: number | null;            // its one-sided 95% lower bound
  missing: string[];               // the tasks whose value of this measure is missing
}
export interface TaskPair { task: string; failed: boolean; diff: Record<string, number | null> }   // a gain per measure
export interface Comparison {
  outcome: 'adopt' | 'regresses' | 'INCONCLUSIVE' | 'refused';
  reason: string;
  n: number;                       // the tasks compared: every one named, failed or missing ones included
  measures: MeasureResult[];       // one per declared measure (empty when refused)
  tasks: TaskPair[];               // one per task compared (empty when refused)
  broke: string[];                 // the tasks with a negative gain on any measure
}
export function planHash(plan: ReplayPlan): string;
/** The one comparison rule, over `tasks` (by default the plan's deciding tasks). */
export function compareReplay(result: ReplayResult, tasks?: string[]): Comparison;
```

**Why the core.** Two callers need the rule now: the eval (an extension) and the learned layer's widening from a
session to a repo (AC8), which lives in the record. The core can't import an extension, so the rule sits in the record
and the eval imports it through the record's public entry. #113 and #118 would call the same function.

### The eval, an extension: `packages/config-eval/src/index.ts` (`@deepbuild/config-eval`)

```ts
export interface ReplayTask { id: string; at: number; repo: string; commit: string; prompt: string }
export interface AgentRun { model: string; prompt: string; cwd: string; env: Record<string, string> }
export interface AgentResult { ok: boolean; result?: string; usage?: { input: number; output: number } }
export interface JudgeRequest { model: string; prompt: string; outputs: { label: string; text: string }[] }
export interface Grade { label: string; score: number }   // 0 to 1
/** Where the agents under test and the judge run: by default the real ones, on your plan. */
export interface Launcher {
  work(run: AgentRun): Promise<AgentResult>;   // the agent's whole view: its model, prompt, folder and environment
  judge(request: JudgeRequest): Promise<Grade[]>;
  planUsed?(): Promise<number | null>;         // the share of the 5-hour window used so far (0 to 1), or null
}
export interface EvalOptions {
  plan: ReplayPlan;
  tasks: ReplayTask[];             // every task the plan names, deciding and fitted, as read from the archive
  root: string;                    // a folder of its own for the agents' checkouts
  env: Record<string, string | undefined>;   // the environment it runs in
  launcher?: Launcher;
}
export interface EvalReport {
  plan: ReplayPlan;                // as frozen
  hash: string;                    // planHash(plan), taken before either side ran
  runs: ReplayRun[];               // every run of both sides, deciding and fitted tasks
  after: Comparison;               // over the plan's tasks, after the cutoff: this decides
  before: Comparison;              // over the fitted tasks, before the cutoff: a reading that never decides
  held: boolean;                   // after.outcome is 'regresses'
  usage: { ms: number; plan_share: number | null };
}
export function runEval(options: EvalOptions): Promise<EvalReport>;
```

A refused eval (a hosted push, a task on the wrong side of the cutoff, a judge of the agents' family) resolves with
`after.outcome: 'refused'`, a reason, no runs, and starts no agent and no judge.

**Metrics the eval knows:** `grade`, the judge's score of a run's output (0 to 1, higher is better), and `tokens`, the
input plus output tokens the agent reported (lower is better), missing when it reported none.

**Tasks are data.** A task is what the eval reads from the transcript archive (#20): the handle of the message that
asked for it, when, the repo, the commit it started from and your words. These tests hand the eval tasks in a fixture
git repo; how the eval builds them from the archive is not tested here (the live run's input brings 20 real ones).

## Readings where the issue and design leave a choice

- **The comparison** (the Scope's one rule). Per task, each side's measure is the mean of its repeats, never the
  maximum or a median; the task's gain is the change's mean minus the base's, signed so a positive gain is better for the
  change (negated for a `lower` measure). Over the `n` tasks compared, `mean` is the mean gain and `sd` the sample
  standard deviation (n − 1). **The bound is `mean − t(0.95, n − 1) · sd / √n`**, the one-sided 95% t bound on the
  paired differences (t(0.95, 19) = 1.729133, t(0.95, 2) = 2.919986). **Adopt** when that bound is above 0 on every
  declared measure. **Regresses** when, on any measure, the other one-sided 95% bound, `mean + t · sd / √n`, is below 0:
  "that bound is worse". Anything else is **INCONCLUSIVE**, including n < 2 (no bound) and a measure with a missing
  value. Reading "regresses" as the lower bound below 0 would make AC8's cohort (a higher mean gain, bound below 0)
  regress, where the issue says it reads INCONCLUSIVE.
- **Refused** is the comparison's fourth outcome: a run whose `plan` isn't the hash of the plan compared (the plan
  changed after either side ran, whichever part changed: tasks, fitted tasks, cutoff, variants, models, repeats or
  measures), a plan naming another rule, or a judge of the agents' family. `planHash` covers every field of the plan and
  not the order of its keys.
- **A failed pair** is a task with a failed side: any of that side's repeats failed or is absent. It stays in `n` and
  in `tasks` with `failed: true`, and its gain on each measure is a number no greater than 0. These tests accept any such
  number (0, or the failed side scored as the worst outcome); they fail every repeat of a failed side, so how a side with
  some failed repeats counts beyond that is the implementer's. Reading a failed base side's metrics as 0 would show the
  change improving.
- **A missing metric** is `null` in its run (an `ok` run whose value wasn't captured, such as usage the agent didn't
  report). The task's gain on that measure is `null`, the task is in that measure's `missing`, and the measure's `mean`
  and `bound` are `null`, so the comparison can't adopt; the task still counts in `n`.
- **The model family** is the model's maker, read from its name: `claude-*` is Claude's family, `gpt-*` (and `o<n>`)
  OpenAI's. So `claude-sonnet-5-5` judged by `claude-opus-5-5` is one family and refused, though
  `adapters/claude-code.facts.json`'s `modelFamily` names them `sonnet` and `opus`; that table names rate cards, not makers.
- **The tasks it broke** are those with a negative gain on any declared measure. **Held** is `report.held` with
  `after.outcome: 'regresses'`; for a learned change, the layer's own states hold it (below).
- **The cutoff.** Deciding tasks are after `plan.cutoff` (`task.at > cutoff`), fitted tasks at or before it; a plan with
  either on the wrong side is refused. Both sides are replayed alike and reported as `after` and `before`; only `after`
  decides. With no fitted tasks, `before` has n 0 and reads INCONCLUSIVE.
- **Agents under test don't know it's an eval.** The agent's whole view is its `AgentRun` and what is in its folder. Its
  prompt is the task's own words, unchanged; its model is the plan's. Nothing in its environment, its folder's path, the
  names of the folders beside it, or its folder's git history, refs, worktrees, stash and local config holds the words
  eval, replay, judge, variant, bench or experiment, a variant's name, the plan's ID or its hash, and no path segment of
  it names a side (base, change, control, candidate, before, after and the like). Its folder holds exactly the files of
  the task's commit with its variant's files written over them, nothing more (`.git` aside). Each repeat starts clean.
- **The judge sees only unlabeled outputs.** Each output's text holds the agent's work (the files it added or changed,
  and its final reply) and none of the variants' instruction files, names, the plan's ID or hash. Labels are distinct
  within a request, name no side, and no label stands for one side every time it appears; across requests showing both
  sides, the base side's output comes first in between 10% and 90% of them, so order tells nothing. The judge's model is
  the plan's, of another family than the agents'. A plan naming a judge of the agents' family is refused, by the eval
  before it starts anything and by `compareReplay`.
- **No eval in hosted CI on push.** The repo's workflows that start on `push`, `pull_request`, `pull_request_target` or
  `merge_group` run neither the eval nor the preflight or lanes that could (there are none at the base, which has no
  workflows). And the eval refuses to run when its environment says GitHub Actions on such an event
  (`GITHUB_ACTIONS=true`, `GITHUB_EVENT_NAME` push or pull_request), while a run you dispatch
  (`workflow_dispatch`) goes ahead, as the Scope's "a lane you dispatch with a budget" allows.
- **The learned layer's widening.** The local-first rule's widening of a change from its session to its repo is a
  `learn.widened` from the core, `applied_by: "rule:localfirst"`, `scope: "repo:<project>"`, `supersedes` the change's
  handle, as #62's README shapes it. It cites its replay by `ev:<sha256>`: an evidence file holding a `ReplayResult` as
  JSON (what the eval's report holds as `plan` and `runs`), with a quote from it. The core reads the file at append, as
  it reads every quote, runs `compareReplay` on it, and records anything but `adopt` as `learn_check.made`, so the
  widening is not in force and its row's `reason` reads INCONCLUSIVE (or regresses); the layer stays a function of the
  log, and a rebuild reads the same. A widening with no replay that decides (only sessions where it "helped again") is
  not in force either: evidence that can't decide never widens anything. The frozen `replay: {tasks, regressions}`
  field is carried as the schema requires; it decides nothing.
- **Standing rules stay as they are.** A complete cohort too small to decide neither widens a change in force at its
  session nor revokes one in force for the repo: the core's `learn.rolled_back` citing only such a replay leaves the
  change in force, and every session's start slice reads as it did.
- **Cohort sizes.** The rule's tests use the issue's numbers: 20 tasks and three repeats (AC7, AC8), and three tasks
  for a cohort too small to decide. The end-to-end tests use 20 tasks where the issue states it (AC7) and 10 or 12
  where it states none, so the suite runs in about a minute on a right program; each replays every repeat of each side
  through a real git checkout.
- **The live run.** `DEEP_EVAL_LIVE=1` opts in; `DEEP_EVAL_INPUT` names a JSON file `{ plan: ReplayPlan, tasks:
  ReplayTask[] }` you export from your archive: a plan of 20 deciding tasks after its cutoff, its variants differing in
  an instruction file (`CLAUDE.md` or `AGENTS.md`), its budget (`ms` at most 2 hours, `plan_share` the share of one
  5-hour window it states), and real tasks in local repos; `DEEP_EVAL_OUT` (optional) is where the report is written.
  The run uses the default launcher (real agents and a judge of another family, on your plan) and an environment without
  the `DEEP_EVAL_*` variables. **Plan share** is the eval's own reading, `report.usage.plan_share`: the 5-hour window's
  used share after the last run minus before the first, as the runner reads windows from the agents' local reports
  (Plan usage, per account and per task); with either reading missing it is `null` and the budget test skips as
  INCONCLUSIVE. Off a reference Mac (Mac15,7 or Mac15,12, on mains, Low Power Mode off, thermal state nominal) the
  numbers are a reading and the test skips as INCONCLUSIVE, never passes. **The merge base has no eval**, so the
  comparison with it is the budget itself; a perf-lane task, as #62's README asks of its budgets, can carry an
  `initialReason` saying so.

## Criteria to tests

| ID | Criterion (short) | Tests | The wrong program, and how it fails |
|---|---|---|---|
| AC1 `#112.324bbab7` | a change that regresses replayed tasks is held, with the tasks it broke | `rule.test.ts` AC1 (6 of 20 tasks broken), `eval.test.ts` AC1 (4 of 10) | a rule or eval with no hold reads the regression adopt or INCONCLUSIVE, or leaves `held` false; one naming all tasks, or none, as broken fails the exact list; an eval whose runs don't carry the judge's grades fails the per-run grades |
| AC2 `#112.e99b571a` | no eval runs in hosted CI on push | `ci.test.ts` | a workflow on push or pull_request that runs the eval, the preflight or the lanes; an eval that runs on a hosted push or pull request (the fake agent starts); one that refuses even a dispatched run |
| AC3 `#112.e0bfcf89` | replayed tasks come from after the cutoff; both sides reported | `eval.test.ts` AC3 (two tests) | an eval that ignores the cutoff starts agents on a plan deciding on a pre-cutoff task, or fitting on a post-cutoff one; one reporting one side lacks `before`; one deciding on the pooled 16 tasks (12 after, 4 fitted) reads INCONCLUSIVE, not regresses (the fitted tasks gain 0.7 to 0.9); one listing a fitted task as broken |
| AC4 `#112.22f2dc6d` | agents don't know it's an eval; the judge sees only unlabeled outputs, from another family | `eval.test.ts` AC4 (two tests), `rule.test.ts` AC4 | a prompt with anything added; an environment variable, folder name, sibling folder, commit message, author, branch or worktree naming the eval, a variant or a side; leftover or extra files in the checkout; a judge shown the instruction files, a variant's name, side labels (`base-1`), or outputs in a fixed order; a same-family judge (`claude-opus-5-5` for `claude-sonnet-5-5`, `gpt-reserve-mini` for `gpt-reserve`) accepted |
| AC5 `#112.477ca7b2` | a plan edited after a side ran is refused; a failed pair stays in the denominator and never improves; a missing metric is missing, not zero; a complete small cohort is INCONCLUSIVE and leaves standing rules | `rule.test.ts` AC5 (four tests), `eval.test.ts` AC5, `widen.test.ts` AC5 | a comparison that doesn't check each run's plan hash, or a hash over only some fields (each of nine edits must change it); a failed pair dropped (n 12, mean above 0.03) or its failed base read as 0 (gain +0.9); a missing tokens value read as 0 or skipped (adopts, `missing` empty); an eval that writes 0 tokens for unreported usage; a rule adopting on a positive mean over 3 tasks; a widener or rollback that acts on that cohort |
| AC6 `#112.756497e6` | 20 tasks in under 2 hours, within the stated plan share, on the reference Mac, against the merge base | `live.test.ts` AC6 (opt-in) | a slower or costlier eval fails on the reference Mac; elsewhere, or with no window reading, INCONCLUSIVE (skipped with the reason) |
| AC7 `#112.72c6ea54` | best-of-three on 15 of 20 tasks with a lower mean is not adopted; keeping each task's best repeat fails | `rule.test.ts` AC7, `eval.test.ts` AC7 | a comparison keeping each task's best repeat adopts (gain +0.2, bound +0.13); an eval that reruns a side until it does well, or keeps only one repeat, fails the three-runs-each check and the kept grades |
| AC8 `#112.dbf62f22` | a learned change widens from session to repo only by this rule; 20 tasks, higher mean, bound below 0: stays at session, INCONCLUSIVE; a widener counting sessions where it "helped again" fails | `rule.test.ts` AC8 (two tests), `widen.test.ts` AC8 | a widener counting the three sessions where it helped again widens on no replay, or on the INCONCLUSIVE one; a rule with z for t, or two-sided t, misses the stated bound; one checking only the first measure adopts the replay decisive on grade and not tokens; a widener that never widens fails the decisive control; one that keeps its judgment outside the log differs after the rebuild |
| Proof | an instruction-file change replayed on 20 real tasks, with its graded results | `live.test.ts` Proof (opt-in) | the live report: 20 tasks after the cutoff, each repeat of each side once, graded 0 to 1 by a judge of another family, under the frozen plan |

### Checked against a throwaway right program

The suite was run against a right program built in a copy of this checkout outside it (in the session's scratch
folder) and deleted afterwards; it was never in the repo. All 19 fast tests passed on it (the eval tests in about a
minute, at a load average near 20). Each of these 23 mutants of it failed the tests named, and no other:

| Mutant | Tests that failed |
|---|---|
| each task's best repeat, not the mean | AC7 rule, AC7 eval |
| a failed pair dropped from the denominator | AC5 rule (failed pair), AC5 eval |
| a failed side's metrics read as 0, the pair not marked failed | AC5 rule (failed pair), AC5 eval |
| a missing metric read as 0 | AC5 rule (missing metric), AC5 eval |
| a missing repeat skipped, the rest averaged | AC5 rule (missing metric), AC5 eval |
| no check of each run's plan hash | AC5 rule (plan edited) |
| `planHash` over the tasks only | AC5 rule (plan edited) |
| z (1.645) for t | AC5 rule (small cohort), AC8 rule (bound) |
| adopt on a positive mean | AC5 rule (failed pair, small cohort), AC8 rule (both), AC8 widen, AC5 widen |
| adopt on the first measure's bound only | AC5 rule (missing metric), AC5 eval, AC8 rule (every measure), AC8 widen |
| a same-family judge accepted | AC4 rule, AC4 eval (refusal) |
| a widener that counts two or more sessions that helped again | AC8 widen |
| a core rollback that ignores its replay | AC5 widen |
| an eval that runs on a hosted push | AC2 |
| no cutoff check | AC3 eval (refusal) |
| `DEEP_EVAL_RUN` in the agent's environment | AC4 eval (views) |
| the side in the checkout's folder name | AC4 eval (views) |
| a line added to the prompt saying it is an evaluation | AC4 eval (views) |
| the instruction file shown to the judge | AC4 eval (views) |
| side labels (`base-1`) | AC4 eval (views) |
| outputs in a fixed order, base first | AC4 eval (views) |
| 0 tokens written for unreported usage | AC5 eval |
| a decision on the pooled tasks, fitted and after | AC3 eval (both sides) |

Not planted: a rule using two-sided t, an eval rerunning a side until it does well (the fake fails a side run more
often than the plan's repeats), and a projection keeping its judgment outside the log (the rebuild check in AC8 widen).

## Files

- `helpers.ts`: criterion IDs; the surface's types; plans and runs for the rule; the record world (a real record over a
  real evidence store, sessions with archived transcripts, learned-layer events, replay results as evidence); the eval
  world (a fixture git repo of five commits, tasks in it) and the scripted fake `Launcher`; the AC4 view checks.
- `rule.test.ts` (AC1, AC4, AC5, AC7, AC8): the rule itself. `eval.test.ts` (AC1, AC3, AC4, AC5, AC7): the eval end to
  end on the fake. `ci.test.ts` (AC2). `widen.test.ts` (AC5, AC8): the learned layer. `live.test.ts` (AC6, Proof):
  opt-in.
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`, as `tests/acceptance/723`.
- `BASE-FAILURE.txt`: the run on the base commit, where every test fails at a named assertion: the record exports no
  `compareReplay` or `planHash`, and `packages/config-eval/src/index.ts` doesn't exist.

### The fake agent and judge

`fakeLauncher` (in `helpers.ts`) is the only stand-in. Its `work` records what the agent could see (its `AgentRun`, the
files in its folder, and for AC4 its folder's git history, refs, worktrees, stash and config, the `.git` file and the
folders beside it), tells its task by the task's words in the prompt and its variant by the instruction file in its
folder (`kestrel` or `osprey`), and does that run's scripted work: it writes `answer.txt` holding a quality and a fresh
nonce, replies naming them, and reports usage unless the script says it reported none, or fails. A side run more often
than the plan's repeats is a problem the tests fail on. Its `judge` scores each output it is shown by the quality in it,
so a grade depends only on an output's content, never on its label or order. Nothing in it stands in for the rule, the
eval or the layer.

No fixture holds a secret or personal data; the repo, its prompts, the hosts and the IDs are made up.
