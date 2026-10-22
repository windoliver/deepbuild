# AC4 blind redraft: unlisted model and tool names fold to `other` before they become readings

Test: `receiver.test.ts`, the `describe` "AC4 model and tool names the facts don't list fold to other before
they become readings", with its one `it` ("AC4 an unlisted model and tool add readings only under other; 1,000
more made-up model names add no reading"), names unchanged. The other tests in the file are unchanged; the
import from `./helpers.ts` adds `logRecord` and `logs`, which helpers already exported.

## What I read

- Issue #42's body (`gh issue view 42 --repo windoliver/deepbuild`): Scope, the AC4 criterion, Proof.
- `AGENTS.md` (Proof), `tests/acceptance/42/README.md`, `helpers.ts`, `receiver.test.ts`, and
  `tests/acceptance/14/AC6-REDRAFT.md` for the form.
- The base record at `a8f844f`: `packages/record/src/index.ts` (`table()`, `Row`, `RecordStore`) and the
  `readings` definition and its `reading.recorded` case in `packages/record/src/projections.ts`, read with
  `git show`/`git grep` at the base.

Nothing under `packages/otlp/` (I listed the worktree only to learn it exists, and so didn't run the tests),
and no diff of `packages/record`, `packages/contracts`, `packages/cli` or `packages/conformance` against the base.

## The dispute, and my reading of it

1. **BigInt rows.** At the base, `table()` reads with `.safeIntegers(true)`, and `readings` is
   `reading TEXT, value TEXT, unit TEXT, as_of INTEGER, source TEXT, n INTEGER, outside INTEGER`. Any row with
   an integer comes back with BigInt values, and the old test's `JSON.stringify(r)` throws
   `TypeError: Do not know how to serialize a BigInt` on the first readings row. A correct receiver would fail
   on that, not on the criterion. **Agreed.**
2. **Only `llm_request` spans.** The README says a request's `request.cost` comes from its `api_request` log,
   never from the `llm_request` span, and leaves which readings the receiver makes to the implementer. A
   receiver that makes model readings only from the cost logs and keys them by the raw name would never see
   the 1,000 names, so it would pass the 1,000-name leg while being the wrong program the criterion names.
   **Agreed.** The criterion says "spans", so the spans stay; Claude Code sends both a span and a log for one
   model request, so each made-up name now goes out the way Claude Code would send it.

## What changed and why

| Change | Why |
|---|---|
| Rows go through `text(r)`, `JSON.stringify` with a replacer that writes a BigInt as its decimal string, wherever the test searches a row's text (the "other" check and the "no raw name" check); the failure message lists the offending rows the same way | Point 1: the check no longer depends on how the record returns integers, only on what the rows say |
| A `request(model)` builder makes one model request: its `claude_code.llm_request` span and its `api_request` log, sharing a `request_id`, both naming `model`, the log with `cost_usd` (0.0007) and the tokens | Point 2: each made-up name reaches the receiver through the path the README says gives a model's cost, alongside the span the criterion names |
| The first leg sends `made-up-model-0000` as that span plus log, and `MadeUpTool` as a `claude_code.tool` span plus its `tool_result` log | So a model or tool reading keyed by the raw name from either signal is seen; same names and the same assertions as before |
| The 1,000-name leg sends ten batches of 100 requests, each batch as one traces export and one logs export, alternating protobuf and JSON as before | Same count, same encodings; every made-up name now arrives on both signals |

Kept as they were: the known prompt first (`claudePrompt`), the readings keyed by the `reading` column, the
assertions that every key the unlisted names add matches `/other/i` and that some row reads `other`, that the
count of distinct `reading` keys after the 1,000 names equals the count after the first unlisted names, and
that no row's text names `made-up` or `MadeUpTool`. The expected values haven't changed, and no assertion was
added or dropped.

## The wrong programs, and how each fails

| Wrong program | How it fails |
|---|---|
| Keys model readings by the raw name from `llm_request` spans | about 1,000 more distinct `reading` keys (the count check); keys such as `…made-up-model-0000…` not matching `other` (first leg); rows naming `made-up-model-…` |
| Keys model readings by the raw name from `api_request` logs (the cost path) | the same three failures; the old test missed this one |
| Folds the model but keeps the raw tool name | the key `MadeUpTool` (or one containing it) added in the first leg doesn't match `other`, and a row names `MadeUpTool` |
| Folds the name into the key but writes the raw name into `value` or `source` | the "no reading names a raw unlisted name" check, by the row's text |
| Makes no reading under `other` for an unlisted name | "the unlisted names are read under other" is false |

A correct receiver, whose `table('readings')` rows hold BigInt integers, no longer fails with a TypeError.

## Type check

Against a declaration-only copy of the README's surface and the base record's types, outside the repo in my
scratchpad, under the root `tsconfig.json`'s strict options plus `allowImportingTsExtensions`/`noEmit`,
`receiver.test.ts` with `helpers.ts` type-checks with no errors. Nothing was added to the repo for this.

## Not run

I didn't run the tests: `packages/otlp/` exists in this worktree, and running them would test the
implementation. On the base (no `packages/otlp`) the suite still fails to import, as `BASE-FAILURE.txt` records.
