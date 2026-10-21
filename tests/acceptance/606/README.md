# Acceptance tests for #606: ask outcomes, access words, and kinds for a child's stop and a task's completion

These tests were drafted blind from issue #606 (its text as of October 20), the issues it links (#311 and #596), `docs/technical-design.md` (Ask, "Every ask ends", Event, Access, Attempt and plan, "What each agent gives us"), `docs/canvas-primitives.md` (The event catalogue, Projections the canvas reads, Closed enums, Control: device bridges, Seam and backend: device classes) and the base commit `f346706`, which is `origin/main` and has no implementation. Per AGENTS.md, the implementing agent doesn't edit them. A dispute goes to a blind redraft by this job.

Run them with:

```sh
npm ci                                                   # once, if node_modules is missing
npx vitest run tests/acceptance/606                      # criteria 1, 2 and 3's contracts half (.test.ts)
node --test tests/acceptance/606/corpus.test.mjs         # criterion 3's replay half
node --test tests/acceptance/606/regression.test.mjs     # criterion 4: runs tests/acceptance/311
```

Use the repo's `vitest.config.ts` (the command above, from the checkout's root), not `--root tests/acceptance/606`: Vitest's own defaults would also pick up the `.test.mjs` files, which are `node:test` files. The root config takes `tests/**/*.test.ts`, so the unit lane runs the three `.test.ts` files too; the `.test.mjs` files run by hand, as the other Node suites under `tests/acceptance/` do. `regression.test.mjs` runs the #311 suite, which builds `deep-contracts` with cargo (about 10 s warm, a few minutes cold); it uses `git` and `origin/main`.

On the base, all ten tests of criteria 1 to 3 fail, each for the expected reason, and the two tests of criterion 4 pass, since it is behavior that must not change. `BASE-FAILURE.txt` shows both, with local paths redacted, and lists the planted programs each test was run against.

## The surface

The tests reach the code only through these:

- The contracts package's public entry, `packages/contracts/src/index.ts`: `catalogue()`, `listSchemas()`, `fixtures(name)`, `validate(name, value)` and `checkViewBindings(kinds)`, with the `ContractIssue` shape #311 defined (`path` a JSON Pointer, `actual` the refused value). Its schema files and fixture layout (`packages/contracts/schemas/<name>.json`, `packages/contracts/fixtures/<name>/*.json`) are reached only through those functions.
- The fixture corpus, read as data: `adapters/corpus/claude-code/<version>/<session>/events.jsonl`, each line `{payload, expect: [{kind, data}], source, reviewed}` (`adapters/corpus/README.md`, #47).
- `node scripts/corpus.mjs replay`, and its JSON lines (`{"type": "payload", "agent", "hook", "case", "verified", "result", "diffs"}` and `{"type": "summary", "verdict"}`).
- The adapter's `replaySession({facts, version, payloads, transcript})` from `adapters/index.mjs`, with `adapters/claude-code.facts.json` as its facts.
- `npx vitest run --root tests/acceptance/311` (as its README runs it), and `git` for whether that folder changed.

## The contract the implementation must meet

### Criterion 1: an ask's outcome

The tests accept either shape the issue offers, and pin neither:

- **An outcome field.** A catalogued kind that is an `ask.*` kind or feeds `asks` has a fixture whose `/data` holds one of the design's ask outcomes at some field, and that fixture with the field set to `superseded` validates, and so does it with `moot` (one fixture per outcome, or one fixture whose field takes both). `ask.cancelled` with `data.because` is the issue's example.
- **A kind per outcome.** The catalogue has `ask.superseded` and `ask.moot`, each with a fixture, and the asks projection derives the outcome from the closing kind.

Either way, every event found that way must:

1. be of a kind whose catalogue entry feeds `asks` ("the asks projection reads it": the catalogue is generated from each schema's `x-feeds`);
2. have an `ask:<id>` subject, since it ends that ask;
3. refuse an outcome outside the closed set, naming it. For a field: the event with the field set to each of `accepted`, `obsolete`, `withdrawn`, `expired`, `rejected`, `replaced`, `stale`, `closed`, `resolved`, `Superseded`, `MOOT`, `superseded `, ` moot`, `superceded`, `super_seded` or the empty string, and to 1,000 generated strings outside the design's nine outcomes, is refused with an issue whose `path` is the field's pointer and whose `actual` is the value. For a kind: every catalogued `ask.*` kind is a step (`created`, `batched`, `later`) or one of the nine outcomes, and 1,000 generated `ask.<word>` kinds outside them are refused by `checkViewBindings` and by the closing kind's schema at `/kind`, naming the kind.

The closed set is the design's: `answered | decided_for_you | escalated | defaulted | unanswerable | cancelled | superseded | moot | unanswered` (canvas-primitives.md, Closed enums: Ask outcome; the asks table in technical-design.md; "Every ask ends"). A field may take a subset of it, as `ask.cancelled`'s `because` might take only `superseded` and `moot` and its plain cancel; it may not take a value outside it.

### Criterion 2: access words

The issue doesn't name the schema. The tests find it by its fixtures: **every published schema with a fixture that holds a string starting with `device:`** carries access words at that place, and at least one must exist. So the implementation's schema needs a fixture with a `device:<class>` word in it. At each such place:

- `sound`, `microphone`, `camera`, `device:pen@1`, `device:midi@1`, `device:touches@1` and `device:ext.tiltpad.phone@1` validate;
- `device:` is refused, naming the place and `device:`;
- `notices`, `schedules`, `secrets`, `Microphone`, `CAMERA`, ` sound`, `sound `, `sounds`, `mic`, `speaker`, `location`, `bluetooth`, `device`, `devices:pen@1`, `Device:pen@1`, `device;pen@1` and the empty string are refused, each naming the place and the word, and so are 1,000 generated strings: any text, and plain lower-case words of 13 to 24 letters, leaving out every spelling of the design's other access words (files, programs, hosts, run-as-you, screen, clipboard, window, agent, `edit_as_you`, record).

The tests don't hold the other access words to any spelling and don't test them, since the criterion names only these four.

### Criterion 3: a child's stop and a task's completion

The corpus decides which kind each resolves to: the kind stored in `expect` for Claude Code's `SubagentStop` and `TaskCompleted` payloads.

- `adapters/corpus/claude-code/<version>/<session>/events.jsonl` holds at least one recorded `SubagentStop` and one recorded `TaskCompleted` payload, in any covered version's set, each stored with its expected events.
- All the events stored for every `SubagentStop` share one kind, and so do those for every `TaskCompleted` ("resolve to one kind").
- That kind is catalogued (`catalogue()`), has at least one fixture, each valid, and is not a kind that starts what it ends (`session.start` or `session.child_started` for a child's stop, `task.created` for a task's completion).
- A child's stop feeds `sessions` or `claims`; a task's completion feeds `tasks`.
- The kind's schema accepts its fixture with `writer` set to `hook`.
- `node scripts/corpus.mjs replay` prints `result: "match"` and `verified: true` for every such payload, and its summary is PASS with exit 0.
- Run through `replaySession`, each `SubagentStop` maps to events whose `data` holds the payload's `agent_id`, and each `TaskCompleted` to events whose `data` holds its `task_id` (as is, or after a `:` or `#`, as in a handle).

**This needs a fresh recording.** The corpus holds recorded payloads only, never adapter output, and the base corpus has no `SubagentStop` or `TaskCompleted` (its sessions fire neither hook). The implementer records a Claude Code session with `node scripts/corpus.mjs record` that starts a subagent which finishes, and has a task marked completed, adds the two hooks to that version's `events.versions` in `adapters/claude-code.facts.json` with their fields, writes the expected events from Claude Code's hooks reference, and gets them reviewed, as #47's corpus rules require. The tests read the payloads' `hook_event_name`, `agent_id` and `task_id` and the stored `expect`, and nothing else from them. Hand-written payloads would pass these tests but not #47's corpus rules, and a reviewer should refuse them.

### Criterion 4: `tests/acceptance/311` passes unchanged

- `git diff --name-status <base> -- tests/acceptance/311` is empty, and `git ls-files --others --exclude-standard -- tests/acceptance/311` lists nothing. `<base>` is `git merge-base HEAD origin/main`, or `DEEP_606_BASE` when set.
- `npx vitest run --root tests/acceptance/311` exits 0 with no failed test file.

## Readings where the issue leaves a choice

- **Which kind carries the outcome** (the issue leaves it to "Every ask ends"). That paragraph and the asks table give the closed set and an `outcome` column, but no kind. The tests accept a field on a closing kind or a closing kind per outcome, and nothing else: an outcome in free text, such as `ask.answered`'s `answer`, isn't closed and fails.
- **"The asks projection reads it."** No projection exists at the base (no hub, #14 and #16), so the tests can't call one. They hold the contract the projection is built from: the kind's catalogue entry feeds `asks`. That a running projection fills `asks.outcome` from it is left to the hub's issues.
- **Finding the access-word schema by a `device:` fixture.** A word such as `camera` may also be an evidence or canvas value elsewhere, so the tests key on `device:`, which only an access word holds, and test every place that holds one.
- **Access words are strings.** The criterion writes `device:<class>` as a word, so the tests assume each word is a JSON string (an array item or a field value). A grant keyed by word, or a `{kind: device, class}` object, isn't supported.
- **The device class's form.** The design names device classes `name@major` (`pen@1`, `midi@1`, `touches@1`), and a plug-in's own class `ext.<plug-in>.<name>@major`, which its manifest's `device:<class>` names (canvas-primitives.md, Seam and backend: device classes; Control: device bridges). The tests require both forms. A pattern that accepts only a bare name such as `device:midi` fails. The plug-in ID `tiltpad` is made up.
- **"Any word outside the list."** The design names notices, schedules and secrets as blocks a manifest declares, "not access words", so those three are refused by name. The generated words leave out every plausible spelling of the other access words, so an implementation's spelling of them isn't pinned.
- **The kind a child's stop or a task's completion resolves to.** The issue lets the implementer pick `agent.stop` (with the child's `session:` subject) or a new kind for a child's stop, and `task.closed` or a new kind for a task's completion. The tests pin only what follows from the design: the kind is catalogued, has a fixture, doesn't start what it ends, and reaches the projection that tracks it (a session's status or the claims judged at a stop; a task's state in `tasks`).
- **The hook writes it.** An adapter's events reach the record through deep-hook, and the Event primitive takes the writer from the connection, so the adapter's kind must accept `writer: hook`. `task.closed` today takes only `core` ("A task was closed by a verdict"), so mapping `TaskCompleted` onto it fails unless its writers change. That follows invariant 1: Claude Code's `TaskCompleted` is the agent's word that a task is done, not a verdict.
- **Naming the child and the task.** A child's stop that loses which child stopped, or a completion that loses which task, can't hold the child gates the design puts on them (Child gates: "SubagentStop, TaskCompleted and TeammateIdle hold each child session until its checks pass"), so the adapter's event must carry `agent_id` and `task_id`. This is my reading; the criterion says only "map onto them".
- **One kind, any number of events.** "Resolve to one catalogued kind" is read as: every event stored for that hook has the same kind. A payload may map to more than one event of it.
- **The base for "unchanged".** The merge base with `origin/main`, so a #311 redraft that lands on `main` and is merged into the branch still counts as unchanged.

## Criteria, tests and wrong programs

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed and the leading `- [ ] ` dropped, computed with the command in `tests/acceptance/48/README.md`. Each test's name starts with its ID.

| # | ID | Criterion (short) | Tests | Wrong programs it fails on | On the base |
|---|---|---|---|---|---|
| 1 | `#606.9092f0b3` | superseded and moot recorded, from a closed set, read by asks; outside refused | `outcomes.test.ts`: *…ends as superseded…*, *…ends as moot…*, *…outside the design's closed set is refused…* | an outcome enum without `moot`; a free-string outcome; an enum with `obsolete`; `ask.superseded`/`ask.moot` feeding `decisions`; an extra `ask.obsolete` kind | FAIL: nothing records either outcome |
| 2 | `#606.1e9b8ac4` | access words accepted; `device:` and outside words refused | `access.test.ts`: *…accepts…*, *…refuses device: with no class…*, *…refuses any word outside the list…* | `device:` with an empty class; a free string; a list without `camera`; a list with `notices`; a class pattern without `@major` | FAIL: no schema carries access words |
| 3 | `#606.23148a24` | a child's stop and a task's completion each one catalogued kind with a fixture; SubagentStop and TaskCompleted map onto them in the replay | `kinds.test.ts`: *a child session's stop…*, *a task's completion…*; `corpus.test.mjs`: *the corpus replay maps…*, *the adapter's event… names the child… the task* | `TaskCompleted` onto `task.closed` (core only); `SubagentStop` onto an uncatalogued `session.child_stopped`; `TaskCompleted` onto `tool.after`; facts that map `TaskCompleted` to another kind than the one stored; an event without the task's ID; two kinds across `SubagentStop` payloads | FAIL: the corpus holds neither hook |
| 4 | `#606.f6e09fa4` | `tests/acceptance/311` passes unchanged | `regression.test.mjs`: *…is unchanged from the base…*, *…passes* | an edit to a #311 file; a file added there; a schema changed without its frozen digest and generated types | PASS (must not change) |

## Files

- `helpers.ts`: JSON Pointer edits, the refusal check (an issue at a path, with the value), the design's nine ask outcomes, and the corpus read as data.
- `outcomes.test.ts`, `access.test.ts`, `kinds.test.ts`: criteria 1, 2 and 3's contracts half, in Vitest, as #311's suite.
- `corpus.test.mjs`: criterion 3's replay half, in `node:test`, as #47's suite.
- `regression.test.mjs`: criterion 4, in `node:test`, so the unit lane doesn't run #311's suite twice.
- `BASE-FAILURE.txt`: the base run and the planted programs.
