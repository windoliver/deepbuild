# Blind redraft: AC4 "agent.stop@1 keeps its schema and frozen digest from the base; agent.stop@2 has a frozen digest of its own; nothing drifts"

The file is `ac4-digest-redraft.test.ts`. It holds the one test, inside a describe block with the same name as
AC4's block, so its full name matches the original's.

## What I read

- Issue #603 (`gh issue view 603`), its Shape and its fourth criterion.
- The base `2307398` (origin/main): `packages/contracts/src/index.ts` and what it exports from `schemas.ts`
  (`listSchemas`, `getSchema`, `fixtures`, `frozenDigests`), `digest.ts` (`d1Digest`, `frozenDrift`) and
  `catalogue.ts`; `packages/contracts/schemas/agent.stop@1.json`; `packages/contracts/fixtures/agent.stop@1/01.json`;
  `packages/contracts/digests.json`.
- `docs/technical-design.md`: "Contracts that can't drift" (line 837, the `d1` definition), "What a minor may
  change" (line 840), Release checks "Frozen contracts" (line 2477) and Dogfooding (line 2508).
- The suite's `README.md` and `helpers.ts`, written in from `2586523` as the instructions say. I read no other
  file of `2586523`, of any other branch, PR or worktree, and not the old draft's body.

## Base value I changed in helpers.ts

`BASE_V1_DIGEST` was `d1:19afe153…b236`, the value at `f346706`. At the base `2307398`, `digests.json` and
`d1Digest(getSchema('agent.stop@1'))` both give `d1:eaddd33caced46ca2441d9da7bb4492c4e22a8f31897edb8c92bd1b25839d6ba`.
I set the constant to that value. I left the constant's doc comment alone, so it still names `f346706`; it
should say `2307398`. I changed nothing else in `helpers.ts` or `README.md`.

## Each assertion and where it comes from

| # | Assertion | Source sentence |
|---|---|---|
| 1 | `agent.stop@1` is still in `listSchemas()` | Shape: "`agent.stop@1` kept in the catalogue" |
| 2 | `frozenDigests()['agent.stop@1']` is the base's `d1:eaddd33c…d6ba` | Shape: "its digest frozen" |
| 3 | `d1Digest(getSchema('agent.stop@1'))` is still that digest | Shape: "its digest frozen"; design line 837: `d1` is the SHA-256 of the normalized schema with annotations left out, "so a reworded description keeps its digest". So the schema's shape may not change, but its wording may. |
| 4 | The base's published `agent.stop@1` fixture still validates as `agent.stop@1`; the same stop with `cause` and `usage` in `data` is refused at `/data/cause` and `/data/usage` | The same frozen shape, seen through the validator. At the base, `data` is closed to `{turn, did_work}`, and design line 840 says making a field required "takes a new major", so version 1 can't take the new fields. This catches a wrong program that widens @1 in place, or sends @1 to @2's schema. |
| 5 | `agent.stop@2` is in `listSchemas()` | Shape: "this is `agent.stop@2`" |
| 6 | `frozenDigests()` has an `agent.stop@2` key, and its value is `d1Digest(getSchema('agent.stop@2'))` | Shape: "its digest frozen, as every other kind's is"; design line 840: "each minor has its own frozen digest" |
| 7 | `agent.stop@2`'s frozen digest is not `agent.stop@1`'s | Shape: "Required fields change the shape", so the new version has its own digest |
| 8 | `frozenDrift(listSchemas(), frozenDigests())` is empty | "as every other kind's is"; design line 2477: "each method matches its frozen digest" |

The order matters. The version 1 assertions come first, and `expectPublished(V2)` runs before `getSchema(V2)`.
On the base, the test therefore fails on an assertion, not on the `unknown_schema` throw.

## What I left out because the issue and design don't state it

- **The catalogue's entries** (`catalogue()` listing kind `agent.stop` at versions 1 and 2). The criterion
  says "the catalogue lists both versions", but this test's title covers only digests and drift. The catalogue
  entry has no digest field, and the sibling test in the same describe block presumably covers it. I didn't
  read that test, so I can't confirm it does.
- **The other kinds' digests pinned to their base values.** "As every other kind's is" describes the policy;
  #603 asks for no other kind to change. Assertion 8 checks that every schema matches `digests.json`, but it
  doesn't pin `digests.json` to the base for kinds other than `agent.stop@1`.
- **A byte-for-byte equal `agent.stop@1.json`.** The design lets annotations change without a new digest, so
  the test pins `d1`, not the file's bytes.
- **Extra `digests.json` entries with no published schema.** `frozenDrift` doesn't catch these, and nothing in
  the issue or design names them.
- **What `agent.stop@2`'s schema holds.** That belongs to AC1, AC2 and AC4's other tests; this one checks only
  its digest.
- **`deprecated_since` / `replaced_by` on `agent.stop@1`.** The design names them for replaced entries, but the
  issue doesn't ask for them, and the base's schemas don't carry them.

## Run on the base

`npm ci --prefer-offline` (node_modules was missing), then
`npx vitest run --root tests/acceptance/603 ac4-digest-redraft`:

```
 ❯ ac4-digest-redraft.test.ts (1 test | 1 failed) 18ms
   ❯ AC4 the catalogue lists both versions, and agent.stop@1 stays frozen (1)
     × AC4 agent.stop@1 keeps its schema and frozen digest from the base; agent.stop@2 has a frozen digest of its own; nothing drifts 17ms

 FAIL  ac4-digest-redraft.test.ts > AC4 the catalogue lists both versions, and agent.stop@1 stays frozen > AC4 agent.stop@1 keeps its schema and frozen digest from the base; agent.stop@2 has a frozen digest of its own; nothing drifts
AssertionError: agent.stop@2 is a published schema: expected [ 'access@1', …(70) ] to include 'agent.stop@2'
 ❯ expectPublished helpers.ts:78:77
 ❯ ac4-digest-redraft.test.ts:33:5

 Test Files  1 failed (1)
      Tests  1 failed (1)
```

The test fails for the expected reason: `agent.stop@2` doesn't exist at the base. Every `agent.stop@1`
assertion before it (1 to 4) passed on the base, which confirms the pinned base values.

Not run: this test against a planted wrong program, such as `agent.stop@1` widened in place, or an
`agent.stop@2` with no `digests.json` entry. The instructions asked only for the base run.
