# Acceptance tests for #3158: a session's cost prices each kind of cache write at its own rate

Written first, from issue #3158 (its findings, scope, six acceptance criteria and proof line), AGENTS.md (Proof), the
design sections the issue links (Plan usage, per account and per task; What each agent gives us, and the limits we
design around) and Dogfooding under How we know version 0 works, at base commit `3c500c0c8`, by a job that never saw
an implementation. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job.

## What was read

At the base, only to learn the surfaces: `packages/readings/src/usage.ts`, `types.ts`, `record.ts` and the package's
entry (`index.ts`, `impl.ts`); `packages/adapters/src/index.ts` and `shipped.ts` (`readUsage`); `adapters/claude-code.facts.json`
(`usage`); the corpus under `adapters/corpus/`; `packages/hub/src/core.ts` (`recordUsage`, where a stop becomes a count)
and `numbers.ts` (`numbersLines`); and the suites `tests/acceptance/45/`, `2316/` and `3065/` for the folder's form.
Anthropic's and Claude Code's prompt caching pages were not read: the rates are the issue's reading of them.

## Run them

```sh
npm ci && npm run build --workspaces     # once: the packages' sources import each other's built entries
npx vitest run tests/acceptance/3158 --reporter=verbose
node node_modules/typescript/bin/tsc -p tests/acceptance/3158/tsconfig.json
```

Node 24 (`.node-version`). No hub, no cargo, no agent, no network. `pricing.test.ts` writes its transcripts under the
OS temp folder and removes them; `corpus.test.ts` reads `adapters/corpus/` and `base-totals.json` and writes nothing.

## Surfaces this suite assumes

The issue names `packages/readings/src/usage.ts`, the rate card, a session's cost, a stop's count and the corpus. The
tests reach them through two public entries, imported from source as `tests/acceptance/45/` does, and read them loosely.

1. **`countUsage(paths, { rateCard? })`** of `@deepbuild/readings`: a session's count from its transcript files. Read
   from it: `cost.basis`, `cost.usd`, and `totals`.
2. **`new UsageTail().read(transcript)`** of `@deepbuild/readings`: a stop's count, which the hub records as
   `turn.usage`. It finds the subagents' files itself, in `<transcript without .jsonl>/subagents/*.jsonl`, so it is the
   surface for "a subagent's file beside its transcript". Read from it: `cost.usd`.
3. **The shipped rate card** prices `claude-opus-4-5` at 5 a million input tokens, as at the base (the issue's
   "6.25 where input is 5"). The tests name no shipped price but through that model and the corpus's three.
4. **A rate card row's two write prices** (AC5 alone). The issue names no field. The suite keeps `cache_write` as the
   five-minute price, which is its name and meaning at the base, and names the one-hour price `cache_write_1h`, after
   the transcript's `ephemeral_1h_input_tokens`. This is the one name the suite adds. Every other test uses the shipped
   card and pins no row shape.
5. **"Reads at least"** (AC3). The issue names no field. The suite reads it on the count's `cost`: any field whose name
   matches `at least` (`at_least`, `atLeast`, `at-least`) set `true`, or any text in the cost that says "at least", at
   any depth. A cost of a session whose every record gives its split must not read so.
6. **Token totals** (AC6). `totals.input`, `output`, `cache_read` and `unknown_turns` by the names they have at the
   base. The cache writes are compared whole and the suite doesn't say how a count names its two parts: it takes
   `totals.cache_write` if that is still a number, the sum of its numbers if it became an object, else the sum of every
   field of `totals` whose name starts with `cache_write`.
7. **`shipped().get(<name>).readUsage(lines)`** of `@deepbuild/adapters` (AC6): the facts' count, input taking in cache
   writes whole. The shipped adapters are named `claude` and `codex`; each reading's `tokens.input`, `tokens.cached` and
   `tokens.output` are read.
8. **A transcript line** is written as Claude Code 2.1.299 and later write it: the write total in
   `message.usage.cache_creation_input_tokens` and the split in `message.usage.cache_creation.ephemeral_1h_input_tokens`
   and `.ephemeral_5m_input_tokens`. A record "with no split" has the total and no `cache_creation` at all.

## Criteria to tests

Each test's name starts with its criterion's tag. Each is a top-level `it`; none asserts with `toThrow`.

| Criterion | Test | What it asserts | At the base |
|---|---|---|---|
| AC1 `#3158.80f74d2a` | `pricing.test.ts` (1) | One message on `claude-opus-4-5` wrote 1,000,000 one-hour and 1,000,000 five-minute tokens and nothing else. Its cost less the cost of the same message without its one-hour writes is 10.00; less the cost without its five-minute writes, 6.25; the whole, 16.25 | fails: 6.25 for 10.00 |
| AC2 `#3158.ee4a9451` | `corpus.test.ts` (3) | Each of the 30 recorded Claude Code sessions that hold usage costs what this file's own count of its records comes to, priced by their split. `2.1.299/desktop-resume` costs 0.3865388 and `2.1.308/permission-answered` 0.00225578, by hand | fails, all three |
| AC3 `#3158.969013e8` | `pricing.test.ts` (1) | One message with a write total of 1,000,000 and no split costs 6.25, and the cost reads "at least"; a session of one message that gives its split doesn't | fails: nothing reads "at least" |
| AC4 `#3158.3dd67f02` | `pricing.test.ts` (1) | A session that wrote 300,000 one-hour tokens, with a subagent's file beside it that wrote 800,000 five-minute tokens, costs 8.00 in one total | fails: 6.875 |
| AC5 `#3158.fad2fa05` | `pricing.test.ts` (1) | AC1's message under a card whose row holds the five-minute price alone, then the one-hour price alone: `basis` is `unpriced` with no `usd` each time. With both prices the same row gives 16.25 | fails: an estimate of 12.50 |
| AC6 `#3158.e3a2e90a` | `corpus.test.ts` (2) | The 33 recorded Claude Code sessions count the totals in `base-totals.json`; the 33 Claude Code and 21 Codex sessions read, through their adapters, the tokens in it | passes: a guard |

The amounts are compared to 6 decimal places in `pricing.test.ts` and to 9 in `corpus.test.ts`, where a session costs
a fraction of a cent.

## Wrong programs

The implementing agent supplies these as planted twins. The issue names each but AC6's.

| Criterion | The wrong program | Where the test fails it |
|---|---|---|
| AC1 | The merge base: prices both kinds at 6.25 | "the 1,000,000 one-hour write tokens cost 10.00 …": 6.25 |
| AC2 | The merge base: prices the corpus's one-hour writes as five-minute ones (the issue's "priced both ways") | each session's cost, and both hand counts |
| AC3 | One that prices the total as one-hour writes | the first assertion: 10.00 for 6.25 |
| AC3 | One that prices the total as nothing | the first assertion: 0 for 6.25 |
| AC3 | The merge base: prices it at 6.25 and says nothing | "the cost reads at least" |
| AC4 | The merge base: prices the session's one-hour writes at the five-minute rate | 6.875 for 8.00. All at one hour reads 11.00, the rates swapped 9.875, the subagent's file left out 3.00 |
| AC5 | One that prices by the one write price a row has, which for the five-minute row is the merge base | `basis` is `estimated`, not `unpriced` |
| AC6 | None named. One that fits: a count that adds the split on top of the write total, or keeps only one part of it | the session's totals differ from `base-totals.json` |

## The two hand counts

Counted from the transcripts' assistant lines, once per message ID, leaving out an API error's `<synthetic>` entries.
Input, output and cache-read prices are the shipped card's at the base, in USD per million tokens. The write prices are
the page's multiples of the input price as the issue gives them: 1.25 for five minutes, 2 for one hour.

**`claude-code/2.1.299/desktop-resume`**, on `claude-opus-5-5`: input 4, output 20, cache read 0.2, so a five-minute
write is 5 and a one-hour write 8. Six assistant lines: line 5 repeats line 4's message, and lines 9 and 15 are
synthetic.

| Line | Message ends | Input | Output | One-hour writes | Five-minute writes | Cache read |
|---|---|---|---|---|---|---|
| 4 (and 5) | `QzRit` | 2 | 303 | 29,599 | 0 | 40,219 |
| 11 | `eSPLB` | 2 | 128 | 10,479 | 0 | 69,818 |
| 17 | `dnALW` | 2 | 5 | 2,388 | 0 | 80,297 |
| **Total** | | **6** | **436** | **42,466** | **0** | **190,334** |

6 × 4 + 436 × 20 + 42,466 × 8 + 190,334 × 0.2 = 24 + 8,720 + 339,728 + 38,066.8 = 386,538.8 per million: **$0.3865388**.
The base prices the writes at 5: 24 + 8,720 + 212,330 + 38,066.8 = 259,140.8, $0.2591408.

**`claude-code/2.1.308/permission-answered`**, on `claude-haiku-5-5`: input 0.1, output 0.5, cache read 0.01, so a
five-minute write is 0.125 and a one-hour write 0.2. Two assistant lines, two messages.

| Line | Message ends | Input | Output | One-hour writes | Five-minute writes | Cache read |
|---|---|---|---|---|---|---|
| 2 | `1B8SJ` | 2 | 98 | 7,662 | 0 | 26,633 |
| 4 | `LyMot` | 2 | 57 | 181 | 0 | 34,295 |
| **Total** | | **4** | **155** | **7,843** | **0** | **60,928** |

4 × 0.1 + 155 × 0.5 + 7,843 × 0.2 + 60,928 × 0.01 = 0.4 + 77.5 + 1,568.6 + 609.28 = 2,255.78 per million: **$0.00225578**.
The base prices the writes at 0.125: 0.4 + 77.5 + 980.375 + 609.28 = 1,667.555, $0.001667555.

The sweep over all 30 sessions is the same count done by `corpus.test.ts` itself (`bySplit`), with the three models'
prices written in the file. Counted once per message ID, the corpus holds 133 usage records with a split, 528,285
one-hour write tokens and no five-minute ones; the issue's 187 records and 813,298 tokens are a count of every
line but the five synthetic ones. Three sessions, the `stop-failure` ones, hold only a synthetic entry and are not priced.

## The base's totals

`base-totals.json` was written by this job from the base's built packages, `3c500c0c8`, before any change:

- `readings`: for each of the 33 Claude Code sessions, `countUsage([transcript]).totals` as it stood: `input`,
  `output`, `cache_write`, `cache_read` and `unknown_turns`.
- `adapters`: for each Claude Code and Codex session, the readings its shipped adapter's `readUsage` gave, each as
  `[input, cached, output]`. Claude Code's input takes in the cache writes whole, as its facts say.

AC6 passes at the base because the file is the base's own count. It proves the criterion only against a change that
moves a total. The corpus's Pi sessions have no `readUsage` and so no totals.

## Left open

- **AC5 against #45's AC7.** `tests/acceptance/45/usage.test.ts` prices its fixture with a card whose row is
  `{ input, output, cache_write, cache_read }` and expects an estimate of $0.01014. Under the issue's scope, "A model
  whose row lacks either reads unpriced", that row reads unpriced, whatever the one-hour price is named. This job
  didn't run #45 against anything; the implementing session will meet it and the owner decides.
- **"A model whose row holds one write price and not the other"** is tested on a session that wrote both kinds. A
  session that wrote only the kind its row prices isn't asserted either way; the scope's sentence reads as unpriced
  there too.
- **"Its session's cost reads at least"** is read on the count's cost, which the hub writes into `turn.usage` as it
  is. That the record's `spend.usd`, the Numbers panel and `deep numbers` carry the words through isn't asserted: no
  hub is started. A session that mixes records with and without a split isn't asserted either.
- **The second half of AC3's check**, that a session whose records all give their split doesn't read "at least", is
  this suite's reading; the criterion states only the first half.
- **AC1's two amounts** are read as differences of whole costs, since the issue names no field for a part's cost.
- **AC2's "priced by their split"** can only show one-hour pricing: the corpus holds no five-minute write. AC1 and AC4
  cover the five-minute rate.
- **The page's rates** for the corpus's models weren't checked against Anthropic's page by this job. The hand counts
  use the base's shipped input, output and cache-read prices and the issue's two multiples.
- **AC6 through the hub.** The hub sums a stop's input as `tokens.input + tokens.cache_write` (`core.ts`,
  `recordUsage`). No test drives a hub, so a change that splits the count and forgets that line passes AC6 here.
- **Scope with no criterion**, so no test: the facts naming where the split is read, a task's and the readings'
  counts keeping two parts, a second price on every shipped row, and Codex's pricing (its token readings are in AC6).
