# Acceptance tests for #311: core schemas, generated types and seq on the wire

Written first, from issue #311 (its text as of October 19, the "Added Oct 9" section included), the design
sections it links (Socket roles and contract versions; One event log, with tables built from it; Hook
protocol; the Event, Ask, Decision and rule, Check, Verdict, Evidence, Budget and Access primitives in
`docs/technical-design.md`; Conventions every primitive uses, Handles, What the kernel holds, Requirement
outcome, The event catalogue and Closed enums in `docs/canvas-primitives.md`) and base commit `0c5e145`, by
a job that never saw an implementation. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job.

Run them (a root with no config of its own uses Vitest's defaults; the repo's `vitest.config.ts` also takes
`tests/**/*.test.ts` from `scripts/lanes.mjs`, so `npx vitest run tests/acceptance/311` and the unit lane
run them too):

```sh
npm ci                      # once, if node_modules is missing
npx vitest run --root tests/acceptance/311
```

`rust.test.ts` runs `cargo build --locked -p deep-contracts --bin deep-contracts` in the checkout first,
and builds one throwaway crate under the OS temp folder with `cargo build --offline` (allow a few minutes
the first time). The tests import `packages/contracts/src/index.ts` with its `.ts` extension; type-checking
them needs `allowImportingTsExtensions` (with `noEmit`). They type-check under the root `tsconfig.json`'s
strict options against the surface below (checked against a declaration-only copy of it outside the repo).

## The surface under test

The issue names schemas and behaviors but almost no code API, so these tests define the smallest one they
need. It is the public entry of a new workspace package, `@deepbuild/contracts`, at
`packages/contracts/src/index.ts`, plus one Rust crate, `crates/deep-contracts` (a workspace member). The
tests import nothing else from the package and read only the files named here.

```ts
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type Schema = { [key: string]: JsonValue };          // one JSON Schema document
export interface SchemaEntry { name: string; schema: Schema }

// The published contract schemas (packages/contracts/schemas/), and their valid fixtures.
export function listSchemas(): SchemaEntry[];
export function getSchema(name: string): Schema;              // throws ContractError for an unknown name
export function fixtures(name: string): JsonValue[];          // packages/contracts/fixtures/<name>/*.json, by file name

// One error shape (Added Oct 9).
export const ERROR_CODES: readonly string[];                  // the closed set of codes
export interface ContractIssue {
  code: string;            // a member of ERROR_CODES
  retryable: boolean;      // whether a retry can help
  remediation: string;     // one remediation action
  path: string;            // JSON Pointer of the refused value: '/seq', '/data/from'; a missing field's own pointer
  actual: string;          // the value refused there (a string as is, anything else as JSON), cut at 8,192 characters
  evidence: string[];      // handles to any partial evidence
}
export class ContractError extends Error implements ContractIssue { /* the same six fields */ }
export type Validation = { ok: true } | { ok: false; issues: ContractIssue[] };   // issues: plain objects with exactly the six fields

export interface Registry {
  validate(name: string, value: unknown): Validation;
  decode<T = unknown>(name: string, json: string): T;  // parses one JSON text, validates it, turns every seq into a bigint; throws ContractError
  encode(name: string, value: unknown): string;        // validates, writes seq back as its decimal string, returns the RFC 8785 text; throws ContractError
}
export function registry(entries: readonly SchemaEntry[]): Registry;
export function validate(name: string, value: unknown): Validation;      // the published schemas' registry
export function decode<T = unknown>(name: string, json: string): T;
export function encode(name: string, value: unknown): string;

// Generated types (packages/contracts/src/generated/types.ts, re-exported), among them:
export type { HookRequest, HookAck } from './generated/types.ts';   // HookRequest.seq: bigint; HookAck.hold_until_ms: number | null

// Hashing.
export function canonicalize(value: JsonValue): Uint8Array;               // RFC 8785 (JCS) bytes, UTF-8
export function sha256Hex(bytes: Uint8Array): string;                     // lower-case hex
export function recordHash(name: string, record: JsonValue): string;      // sha256Hex of canonicalize(record without the pointers its schema's x-hash.excludes lists); never validates
export function d1Digest(schema: Schema): string;                         // 'd1:' + 64 hex
export function parseDigest(text: string): { algorithm: 'd1'; hex: string }; // throws ContractError for anything else
export function frozenDigests(): Record<string, string>;                  // packages/contracts/digests.json: schema name → frozen digest
export function frozenDrift(entries: readonly SchemaEntry[], frozen: Readonly<Record<string, string>>): string[];
//   the names, in entry order, whose frozen digest is missing, isn't a well-formed d1 digest, or isn't their current d1

// The preflight's schema lint and the generators.
export interface LintProblem { schema: string; path: string; reason: string }   // path: JSON Pointer into the schema
export function lintSchemas(entries: readonly SchemaEntry[]): LintProblem[];
export function generateTypeScript(entries: readonly SchemaEntry[]): string;
export function generateRust(entries: readonly SchemaEntry[]): string;

// The event catalogue.
export interface CatalogueEntry { kind: string; version: number; schema: string; feeds: string[] }
export function catalogue(): CatalogueEntry[];                            // = buildCatalogue(listSchemas())
export function buildCatalogue(entries: readonly SchemaEntry[]): CatalogueEntry[];
export function catalogueDrift(sources: readonly { where: string; text: string }[]): { kind: string; where: string }[];
export function checkViewBindings(kinds: readonly string[]): Validation;  // an issue per uncatalogued kind: path '/<index>', actual the kind

// Handles.
export const HANDLE_SCHEMES: readonly string[];
export interface Handle { scheme: string; id: string; fragment?: string }
export function parseHandle(text: string): Handle;                        // throws ContractError; for an unlisted scheme, actual is the scheme
export function printHandle(handle: Handle): string;

// The hook reply join.
export interface HookContribution { extension: string; firstParty: boolean; deny?: { reason: string }; context: string[] }
export interface JoinedHookReply {
  order: string[];                                   // extension IDs in join order
  bound: number;                                     // the total context bound, in characters
  denies: { extension: string; reason: string }[];   // every deny, in join order
  context: { extension: string; text: string }[];    // the blocks kept, in join order, each possibly cut
}
export function joinHookReplies(contributions: readonly HookContribution[], bound: number): JoinedHookReply;
export function contextBoundFor(timeBudgetMs: number): number;

// Features listed on connect (Added Oct 9).
export function negotiateFeatures(client: readonly string[], hub: readonly string[]): { on: string[]; off: string[] };
//   on: the client's features the hub lists, in the client's order; off: the client's features it doesn't
```

### The schemas the tests name

| Name | What it holds |
|---|---|
| `hook.request@1` | The design's request line: `{v, agent, event, seq, id, pid, ppid, matched, payload}`, closed. `seq` canonical decimal 0 to 2^63 − 1; `id` a ULID (Crockford base32, 26 characters, first at most `7`); `matched` an array of guard names. |
| `hook.ack@1` | `{ack, hold_until_ms}`: `ack` a ULID; `hold_until_ms` null or a whole number ≥ 0. |
| `hook.reply@1` | The reply line deep-hook prints: `{exit, stdout, stderr}`. |
| `hook.joined@1` | What `joinHookReplies` returns, with `order` and `bound` required. |
| one per event kind | Named by `catalogue()` (`entry.schema`). An instance is a whole event: `{v, id, kind, actor, scope, writer, ts, data, …}`, closed, with `v` the kind's version (`const`), `kind` its kind, the kind's fields under `data` as the canvas catalogue lists them, and `actor` and `scope` required strings. |
| `check@1` | `{kind, runner, inputs, depth, oracle, contract}`; `oracle` is `code`, `model` or `person`. |
| `verdict@1` | The verdict record that is hashed, with `outcome` at `/outcome` and its root `"x-hash": {"excludes": [...]}` naming the display fields (local paths among them) its hash leaves out. |
| `guard@1` | `{match, scope, mode: watch \| warn \| block, reason, next_step, fail_closed}`. |
| `error@1` | `ContractIssue`, `code` an enum of `ERROR_CODES`. |

Every published schema has at least one fixture in `packages/contracts/fixtures/<name>/`, and each fixture
of an event kind has `kind` equal to the kind and `v` equal to its version. The tests mutate these
fixtures at the paths the design names (`/actor`, `/scope`, `/v`, `/data/owner`, `/data/deadline`,
`/data/fallback`, `/data/default`, `/data/pinned_to`, `/data/from`, `/data/kind`, `/data/requirements/0/oracle`,
`/oracle`, `/mode`), so the fixtures must hold those fields there: an `ask.created` fixture with
`data.owner`, `deadline`, `fallback`, `default`, `pinned_to` and `kind`; `task.created` with `data.owner`;
`definition.locked` and `verdict.made` with `data.requirements[0].oracle`; and `tool.before` fixtures
covering each of its eight tool kinds in `data.kind` (an `mcp` call may carry its server and tool).

### Files the tests read

- `packages/contracts/src/generated/types.ts`: exactly `generateTypeScript(listSchemas())`, type-only.
- `crates/deep-contracts/src/generated.rs`: exactly `generateRust(listSchemas())`.
- `packages/contracts/digests.json`: the frozen digests, one per published schema.
- `docs/canvas-primitives.md`: its event catalogue table, read live (AC1).

### The Rust crate

`crates/deep-contracts`, a workspace member that builds with `--locked`, has a binary `deep-contracts`:

- `deep-contracts roundtrip <schema>` reads one JSON document per stdin line, decodes each into the
  generated Rust type for `<schema>`, encodes it back as RFC 8785 text, and writes one line per input. On
  any document it can't decode it writes a message naming the schema and the field to stderr and exits
  non-zero.
- `deep-contracts jcs` reads one JSON document per line and writes its RFC 8785 text per line.

`generateRust(entries)` returns one Rust source file that compiles as a module (`mod generated;`) of a crate
whose only dependency is `deep-contracts` (by path), so it reaches serde or anything else only through
`deep_contracts::…` paths (inside the crate itself, `extern crate self as deep_contracts;` makes the same
file compile), and that defines

```rust
pub fn roundtrip(schema: &str, json: &str) -> Result<String, String>
```

decoding `json` into the generated type for `schema` and returning its RFC 8785 text. The binary's
`roundtrip` command is this function over the published schemas. AC22 writes `generateRust` of the
node-type fixture schemas into a temp crate with that one dependency and the workspace's `Cargo.lock`, and
builds it offline.

## Readings where the issue and design leave a choice

- **The version field.** The design gives the event as `{id, kind, subject, writer, actor, scope, data, ts}`
  and says each kind carries a schema version, without naming the field. The tests use `v`, as the hook
  request does.
- **Who an ask or task is for** is `data.owner`, the field the catalogue and the Ask primitive name.
- **"Every assertion names its oracle"** is read as the three places the design puts an oracle: a check
  (`check@1`), a requirement in a definition (`definition.locked`) and a requirement outcome
  (`verdict.made`).
- **The reply schema "names the join order and the bound".** The wire reply is `{exit, stdout, stderr}` in
  the design, with no room for either, so the tests put them on the joined reply, `hook.joined@1`. The join
  order is the design's (first-party extensions, then every other package, each group by extension ID); the
  bound is in characters; deny reasons are kept whole and outside the context bound; a cut keeps each
  block's start (the tests allow up to 50 characters of the share for a cut marker); blocks of a group that
  get no room may be dropped or left empty. `contextBoundFor` is only held to be a positive integer that
  grows with the time budget, since the issue gives no formula.
- **ULIDs** are checked by the spec's canonical form: 26 Crockford base32 characters, upper case, the first at
  most `7`. Lower case isn't tested.
- **The drift rule for issue bodies.** A backticked `<family>.<name>` (lower case and `_`) is an event kind
  when `<family>` is the family of a catalogued kind; `rules.json`, `deep.record.append` and `hold_until_ms`
  are not. "Kinds the design documents" are the canvas catalogue table and the Event primitive's list, not
  every backticked name in the docs (see the disagreements below). `where` is the source's own label.
- **d1** drops the four annotations only where a schema sits (not a property *named* `title`), replaces each
  `#/$defs/…` `$ref` by its definition and then drops `$defs`. The planted schemas carry no `$id` or
  `$schema`, which the issue doesn't place.
- **The hashed-schema marker** is a root keyword, `"x-hash": {"excludes": [<JSON Pointers>]}` (`*` for every
  array item), which the closed-node lint allows like an annotation, and which is how the wide-integer rule
  knows a schema is hashed. A hashed integer "can pass 2^53" when its `maximum` is absent or above
  9,007,199,254,740,991.
- **Closed node forms.** A map is `{type: object, propertyNames: {pattern}, additionalProperties: <schema>}`;
  null beside one type is `{"type": [<type>, "null"]}`; a constant is `{"const": …}`; a union is `oneOf` of
  closed objects each with one required `const` field of the same name; the listed formats include `ulid`.
  An object with no `additionalProperties: false` is open, and fails the lint.
- **AC12's "add nothing at runtime"** is read as: the generated types module compiles to no JavaScript (the
  bigint parsing lives in `decode`/`encode`, typed by the generated types).
- **Rust refusals.** Only three are required of the Rust request type: no `matched`, `seq` as a JSON
  number, and a field it doesn't list. Range and form checks on `seq` are the hub's, and stay in TypeScript.
- **`unknown` opens no ask** is the adapter's behavior (not in this issue's surface); only the schema is
  tested.

### Where the issue and the design disagree (flagged, not picked)

1. **`user.ask`'s `from`.** The issue lists six values, `unknown` among them; the canvas catalogue table lists
   five (`person | scheduled | subagent | session | continuation`). The tests follow the issue's criterion.
2. **`learn.paused` in #311's own body.** The criterion's planted body names `learn.paused`, but #311's body
   names it in backticks too, so a drift test over every issue body, by the backtick rule, fails on #311
   itself. The design's own backticks also name `verdict.created`, `sendback.delivered` and `claim.point` (as
   names it didn't keep) and codes such as `layer.unsupported` and `reading.overflow` in event families.
   The tests run the drift only over planted bodies and hold the design to its catalogue table.
3. **The hook request's `payload`** is "the agent's hook JSON, unchanged", an object open to any field,
   which the closed node types forbid. The tests use `{"tool_name": "Bash"}` and don't pin its type.
4. **Child sessions, tasks and worktrees "(started, stopped, created, completed, removed)".** The design
   names `session.child_started`, `task.created`, `task.closed`, `worktree.created` and `worktree.removed`,
   and no kinds for a child stopping or a task completing. The tests require only the named ones.
5. **"Every ask … ends: its outcome comes from a closed set that includes superseded and moot"** and
   **"evidence carries a redaction label and a license; the access words include sound, microphone, camera
   and `device:<class>`"** are scope lines with no criterion; they aren't tested here.

## Criteria to tests

Each test's name starts with its ID. Where a criterion names a wrong program, a comment at the assertion
that catches it says so.

| ID | Criterion (short) | Tests |
|---|---|---|
| AC1 | every event kind in the design has a schema with a version field | `events.test.ts` AC1 (59 kinds from the base's catalogue table and Event primitive, plus the live table) |
| AC2 | no actor or scope, or an ask without an addressee, fails | `events.test.ts` AC2 (every kind; `ask.created` and `task.created` owner) |
| AC3 | types generated from the schemas, never by hand | `codegen.test.ts` AC3 (committed TS and Rust equal the generators' output; a planted field reaches both) |
| AC4 | no oracle, or an ask without deadline, fallback and default, fails | `events.test.ts` AC4 |
| AC5 | frozen digests are `d1:<hex>`; an unknown prefix fails the contract test | `d1.test.ts` AC5 |
| AC6 | an ask without `pinned_to` fails | `events.test.ts` AC6 |
| AC7 | a view bound to an uncatalogued kind is refused, naming it | `catalogue.test.ts` AC7 |
| AC8 | joined reply over its bound keeps every deny, cuts from the end; schema names order and bound | `hook.test.ts` AC8 |
| AC9 | seq refusals (JSON number, `-1`, `+1`, `01`, `1e3`, `1.0`, ` 1`, `9223372036854775808`), `0` and `9223372036854775807` pass; id a ULID | `hook.test.ts` AC9 (with a 1,000-case property over seq strings) |
| AC10 | seqs parse to bigints through the generated types and print back | `hook.test.ts` AC10 (with a 1,000-case property over 0 to 2^63 − 1) |
| AC11 | `user.ask` `from`: missing or outside the six fails; one fixture per value passes | `events.test.ts` AC11 |
| AC12 | validating an event under 20 µs at p95; generated types add nothing at runtime | `budgets.test.ts` AC12; `codegen.test.ts` AC12 |
| AC13 | one handle grammar; an unlisted scheme is refused, naming it | `handles.test.ts` AC13 (with 1,000-case properties) |
| AC14 | planted feature `f_test` | `features.test.ts` AC14 (partly BLOCKED, below) |
| AC15 | four reshapes change `d1`; a description doesn't | `d1.test.ts` AC15 |
| AC16 | catalogue generated from schemas; drift test; `transcript.archived`, `learn.*`, `tool.before` `mcp`/`unknown`; planted `learn.paused` fails | `catalogue.test.ts` AC16 |
| AC17 | the acknowledgement `{ack, hold_until_ms}` | `hook.test.ts` AC17 |
| AC18 | Rust types from the same schemas; fixtures round-trip to identical bytes; a hand-written request type without `matched` fails | `rust.test.ts` AC18 |
| AC19 | RFC 8785 kernel fixture; TS and Rust encoders; permuted keys keep the hash; U+E000 and U+1F600 | `canonical.test.ts` AC19 (with a 1,000-case property); `rust.test.ts` AC19 |
| AC20 | wide hashed integers are decimal strings; a verdict hash leaves out only listed fields | `hash.test.ts` AC20 |
| AC21 | `d1` inlines `$ref`, drops annotations; `$defs` move and key reorder keep it; file bytes don't | `d1.test.ts` AC21 |
| AC22 | closed node types; one fixture schema per node type round-trips through TS and Rust; `anyOf`, `if`, `patternProperties`, `additionalProperties: true` fail naming schema and path | `lint.test.ts` AC22; `rust.test.ts` AC22; `events.test.ts` (closed event objects) |
| Oct 9 | a published shape changed without a new minor or name fails; errors share one shape; features listed on connect | `d1.test.ts` (frozen drift), `errors.test.ts`, `features.test.ts` |

## Criterion 12: budgets

`budgets.test.ts` times `validate` on the first fixture of `user.ask`, `tool.before` and `verdict.made`:
10,000 warm-up calls, then five runs of 10,000 timed calls each, a run's reading being its p95 in µs. Per the
design's rule for timing results (the same judge as `tests/acceptance/15`), it passes when all five are
within 20 µs, fails when all five are over it by more than the margin (the larger of 5% and the runs'
spread over the limit), and is otherwise INCONCLUSIVE. It counts only on the reference Mac (Mac15,7, on
mains power, Low Power Mode off, no thermal warning); anywhere else, and when INCONCLUSIVE, the test is
skipped with that reason, never passed. The merge-base comparison belongs to the perf lane
(`scripts/perf.mjs`, `benchmarks/budgets.json`), which measures commands: the implementer adds a task that
validates events in a loop and exits 0, with an `initialReason` saying the merge base has no contracts
package. "The generated types add nothing at runtime" is tested everywhere: the generated module compiles
to no JavaScript statements.

## Criterion 14: what is BLOCKED

The contracts own three parts of it, and they are tested: the hub's request schema refuses a request with
`f_test`, naming `/f_test` (a hub that ignores the field fails here); the client can't encode one; and
`negotiateFeatures` turns off only the feature the hub doesn't list (the Done-when's older hub with a newer
deep-hook). What needs a deep-hook built with a planted feature, forwarding to a running hub and acting as
with the hub down is BLOCKED at this base: deep-hook's forwarding isn't implemented (`crates/deep-hook`
exits "Hook forwarding is not implemented") and the hub's socket is another issue's (#16). Faking either
would prove nothing about the real ones.

## The oracle lane

The issue's Oracle line points at other projects' tests for 8 of the 22 criteria, in the maintainers'
private oracle repo, run against this output (#136). This job can't read that repo, so that lane is
BLOCKED here with one unblock ask; these tests don't stand in for it.

## Fixtures

- `fixtures/rfc8785-kernel.json`: one record of each hashed kind (a verdict record, a definition of done, an
  approval's plan, an ask's key, an open item's ID, a package envelope whose keys include U+E000 and U+1F600)
  plus a numbers record, each as a JSON text with keys out of order and whitespace, with its RFC 8785 text and
  SHA-256. They were computed before any encoder existed, outside the repo, by two independent throwaway
  encoders that agreed on every record: a Python one (keys sorted by their UTF-16-BE bytes, numbers by
  ECMA-262 Number::toString over `repr`'s shortest digits, strings escaped by RFC 8785's rules) and a Node one
  (`Object.keys().sort()` and `JSON.stringify`). The test also checks each hash against its canonical text.
- `fixtures/d1/`: the planted method (`method.json`), the same method with `mode` moved into `$defs`
  (`method-defs.json`) and with its keys reordered (`method-reordered.json`), and `expected.json`, its `d1`
  computed the same way before any digest code existed. The four reshapes are made from `method.json` in the
  test.
- `fixtures/hook/`: the design's request example, the acknowledgement in both valid forms, and two replies.
- `fixtures/nodes/`: one fixture schema per closed node type (14: object, map, array, string with a pattern, a
  length, an enum or a format, integer, number, boolean, constant, null beside a type, union, reference), each
  with valid instances.
- `fixtures/lint/`: planted schemas using `anyOf`, `if`/`then`, `patternProperties`, `additionalProperties:
  true`, `allOf`, `not` and an object left open, each inside `/properties/value`.
- `fixtures/issue-learn-paused.md` and `fixtures/issue-clean.md`: the planted issue body and its clean twin.

No fixture holds a secret or personal data; the ULIDs, hashes and commits are made up or are this repo's.

## Files

- `helpers.ts`: JSON Pointer edits, fixture loading, refusal assertions, the ULID generator, the design's
  kind list and the live catalogue-table reader, the kernel fixture.
- `BASE-FAILURE.txt`: the run on the base commit, where every suite fails because the package doesn't exist.
