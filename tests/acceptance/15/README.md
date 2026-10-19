# Acceptance tests for #15: the evidence store

Written first, from the issue, `docs/technical-design.md` (Evidence, Privacy, the Evidence primitive,
Reading by reference, Dogfooding, Built to be hard to get wrong) and base commit `3fa7758`, by a job that
never saw an implementation. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job.

Run them (the repo's `vitest.config.ts` includes only `packages/**`, and a root with no config of its own
uses Vitest's defaults):

```sh
npx vitest run --root tests/acceptance/15
```

Once the implementer adds `tests/acceptance/**/*.test.ts` to `vitest.config.ts`'s `include`, plain
`npx vitest run tests/acceptance/15` runs them too. The tests import `packages/evidence/src/index.ts`
with its `.ts` extension; type-checking them needs `allowImportingTsExtensions` (with `noEmit`). They
type-check under the root `tsconfig.json`'s strict options against the surface below.

## The surface under test

The issue and the design name no code API, so these tests define the smallest one the store needs. It is
the public entry of a new workspace package, `@deepbuild/evidence`, at `packages/evidence/src/index.ts`.
The tests import nothing else from it.

```ts
export type Origin = 'deepbuild' | 'you' | 'agent';
export type Redaction = 'complete' | 'incomplete' | 'unknown';
export type MediaType = 'png' | 'jpeg' | 'mp4';
export type ShareVia = 'export' | 'report' | 'post';

export interface License { name: string; allows: readonly ShareVia[] }

/** What the hub's socket proved about a writer's connection (#16 proves it; the store only reads it). */
export type Peer =
  | { role: 'deepbuild'; via: 'render' | 'capture' | 'journey' | 'job' | 'export' }
  | { role: 'you'; via: 'paste' | 'drop' | 'picker' }
  | { role: 'agent'; session: string };

export interface EvidenceStoreOptions {
  root?: string;        // default: join(os.homedir(), '.deepbuild', 'evidence')
  now?: () => number;   // ms since the epoch; default Date.now
  hooks?: {
    /** Awaited by every put after it checked whether the file exists and before it writes. */
    afterExistsCheck?(sha256: string): void | Promise<void>;
  };
}
export function openEvidenceStore(options?: EvidenceStoreOptions): Promise<EvidenceStore>;

export interface EvidenceStore {
  connect(peer: Peer): Writer;
  get(sha256: string): Promise<Evidence | undefined>;
  read(sha256: string): Promise<Uint8Array>;
  admitBaseline(sha256: string): Promise<void>;
  retain(input: RetainInput): Promise<RetainResult>;
  send(request: SendRequest, boundary: SendBoundary): Promise<Receipt>;
}

export interface Writer {
  put(request: PutRequest): Promise<PutResult>;
  text(request: TextRequest): TextSink;
}
interface Common {
  kind: string;                      // 'screenshot', 'video', 'recording', 'log', 'transcript', …
  source: string;                    // where it came from, such as 'journey:checkout#3'
  redaction: Redaction;              // required: a request without a valid label is refused
  license: License;
  derivedFrom?: readonly string[];   // hashes of the files this one was made from
  origin?: Origin;                   // what the call claims; never decides the stored origin
}
export interface PutRequest extends Common {
  bytes: Uint8Array;
  declares?: MediaType;              // the type the slot declares; when set, intake checks the bytes
}
export interface TextRequest extends Common {
  /** What the hub holds for this run: the env it passes to the process and the values it injected or holds by handle. */
  run?: { env?: Readonly<Record<string, string>>; held?: readonly string[] };
}
export interface TextSink {
  write(chunk: Uint8Array | string): Promise<void>;   // output chunks, in order, cut anywhere
  close(): Promise<PutResult>;
}

export type SlotReading =
  | { state: 'captured' }
  | { state: 'truncated'; missing: string }
  | { state: 'missing'; reason: string };
export type PutResult =
  | { status: 'stored'; evidence: Evidence; slot: SlotReading }
  | { status: 'refused'; reason: string; slot: { state: 'missing'; reason: string } };

export interface Evidence {
  sha256: string;                    // of the stored (scrubbed) bytes
  size: number;
  type: MediaType | 'text' | 'binary';
  kind: string;
  source: string;
  origin: Origin;
  redaction: Redaction;
  license: License;
  derivedFrom: readonly string[];
  intake: 'captured' | 'truncated';
  missing?: string;                  // with intake 'truncated': 'IEND', 'EOI' or 'moov'
}

export interface RetainInput {
  cited: ReadonlySet<string>;        // hashes a decision cites (decisions are owned elsewhere)
  archived: ReadonlySet<string>;     // hashes a transcript.archived event links (the event log, #14)
}
export interface RetainResult { removed: string[] }

export interface SendRequest {
  files: readonly string[];          // sha256 hashes; anything else is a path and refuses the request
  via: ShareVia;
  destination: string;               // the host it goes to
}
export interface ShareAsk { sha256: string; destination: string; via: ShareVia; reason: string }
export interface SendBoundary {
  ask(question: ShareAsk): Promise<boolean>;                                          // the ask router; true is your yes
  deliver(file: { sha256: string; bytes: Uint8Array }, destination: string): Promise<void>; // the transport
}
export interface Receipt {
  sent: { sha256: string; destination: string }[];
  withheld: { sha256: string; reason: string }[];
}

export class EvidenceError extends Error {
  readonly code: 'missing' | 'corrupt' | 'refused';
  readonly sha256?: string;
}
```

### What each part means

- **`openEvidenceStore`** opens the store at `root`. Each file is stored once at `<root>/ab/cdef…`: the
  first two hex characters of its SHA-256 as a folder, the rest as the file name (an extension after it,
  such as `.png`, is allowed). The record of each file (`Evidence`) is the store's own; the event log
  that will carry type and size is #14's.
- **`connect(peer)`** returns a writer bound to one connection. Every file written through it records
  `origin` from the peer: `deepbuild` for `role: 'deepbuild'`, `you` for `role: 'you'`, `agent` for
  `role: 'agent'`. The request's own `origin` is never used. A file whose `derivedFrom` names any file
  with origin `agent` records `agent`. `derivedFrom` is kept on the record as given.
- **`put`** stores binary evidence. With `declares`, intake checks the bytes: leading bytes of another
  type refuse the file (`status: 'refused'`, nothing stored, the slot reads `missing` with a reason naming
  both types); a PNG with no `IEND` chunk, a JPEG with no end-of-image marker, or an MP4 whose boxes
  don't add up to the file or have no `moov` box is stored with `intake: 'truncated'` and `missing`
  naming what's absent, and its slot reads `truncated`. Anything else reads `captured`.
- **`text`** stores text evidence from output chunks cut at any byte. Before the bytes are hashed or
  written, the scrub removes keys, tokens and secret-shaped strings by pattern (at least every rule of
  the pinned gitleaks default config, below), and by value: every `run.held` value, and every
  `run.env` value whose name contains `TOKEN`, `KEY`, `SECRET`, `PASSWORD` or `AUTH`, whose value
  matches a secret pattern, or whose value is one word of 16 characters or more that isn't a path or a
  list of paths. Short plain values such as `CI=true`, `NODE_ENV=test`, `TZ=UTC` or a leased port stay.
  A value is removed raw, URL-encoded (every byte outside `A-Z a-z 0-9 - _ . ~` as `%XX`, hex in either
  case), and in base64 after 0, 1 or 2 leading bytes in both the standard and URL-safe alphabets, even
  when the chunks cut it anywhere. What the scrub replaces it with is the store's choice; everything
  else is stored byte for byte. The stored label is the request's, except text the scrub can't read
  (bytes that aren't valid UTF-8), which is labelled `incomplete`.
- **A request without a valid `redaction`** label is refused, and nothing is written.
- **`get`** returns the record, or `undefined` once retention removed it or it was never stored.
- **`read`** returns the bytes after checking they still hash to `sha256`. It rejects with
  `EvidenceError` code `corrupt` (message naming the hash) when they don't, and `missing` when the file
  is gone; it never returns bytes that aren't that hash.
- **`admitBaseline`** is what a decision calls before it takes a file as a baseline: it resolves for a
  captured file and rejects with code `refused`, naming the hash, for a truncated, missing or corrupt one.
- **`retain`** removes evidence whose newest put is more than 30 days before `now()`, except hashes in
  `cited` or `archived`, which are kept however old. A removed file is gone from disk and from `get`.
  The test hook `afterExistsCheck` lets a test run `retain` between a put's existence check and its
  write; the store holds no lock `retain` needs while it awaits the hook, and a put always leaves its
  file present and readable when it resolves, even if the file existed when it checked.
- **`send`** is the only way bytes leave the machine. A request whose `files` holds anything but 64
  lower-case hex characters is a path request: it rejects with code `refused` before any file is read,
  asks nothing and delivers nothing. Each file needs your yes through `ask` before `deliver` when its
  origin is `agent` (asked once per hash and destination: a yes is remembered for that pair), its
  redaction isn't `complete`, or its license doesn't allow `via`. One ask per file covers all its
  reasons and names its hash and destination. Nothing of an asked file goes out before the answer; a
  no withholds it. Files with origin `deepbuild` or `you`, `complete` redaction and a license that
  allows `via` go without an ask. The receipt lists every file that went out by hash and destination.

The scope also covers series batch files and minute rollups (#262), the newest `layer.rows` file per
layer (#259), and a video's step times. No acceptance criterion here exercises them, so they are not part
of this tested surface; the implementer may add optional fields for them.

### Boundaries the tests inject instead of building

Per AGENTS.md (mock only at boundaries you don't own), the tests never build a component another issue
owns. They hand the store: a clock (`now`), a root folder, the hashes decisions cite and the hashes
`transcript.archived` events link (`retain`), what the hub knows about a connection (`Peer`, #16) and a
run (`run`), and the ask router and the transport (`SendBoundary`).

## Criteria to tests

| ID | Criterion (short) | Test file |
|---|---|---|
| AC1 | same bytes twice keep one file | `store.test.ts` |
| AC2 | planted fake API key redacted before storage | `redaction.test.ts` |
| AC3 | retention keeps cited and archived, removes expired | `store.test.ts` |
| AC4 | no redaction label is refused | `store.test.ts` |
| AC5 | patternless secret, three forms, split chunks; unscrubbable is `incomplete` | `redaction.test.ts` |
| AC6 | incomplete/unknown/unlicensed never leaves without your yes | `sharing.test.ts` |
| AC7 | truncated PNG, JPEG, MP4 kept as truncated | `intake.test.ts` |
| AC8 | JPEG to a PNG slot refused, slot missing | `intake.test.ts` |
| AC9 | truncated screenshot refused as a baseline | `intake.test.ts` |
| AC10 | origin from the connection, kept through a job | `origin.test.ts` |
| AC11 | agent file: one ask per hash and host; path refused | `sharing.test.ts` |
| AC12 | budgets on the reference Mac | `budgets.test.ts` (and the perf tasks below) |
| AC13 | every gitleaks default rule redacted | `gitleaks.test.ts` |
| AC14 | short plain env values kept, secret ones scrubbed | `redaction.test.ts` |
| AC15 | base64 at offsets 0, 1, 2 in both alphabets | `redaction.test.ts` |
| AC16 | seeded property test, 1,000 cases | `scrub-property.test.ts` |
| AC17 | changed bytes read as corrupt; put during retention | `store.test.ts` |
| AC18 | canary sweep with the hub up and down | not testable at base (below) |

Each test's name starts with its ID. Where a criterion names a wrong program, a comment at the assertion
that catches it says so.

## Criterion 13: the pinned gitleaks rules

`fixtures/gitleaks-v8.30.1/` holds `config/gitleaks.toml` and `LICENSE` (MIT, © 2019 Zachary Rice) from
gitleaks tag `v8.30.1`, commit `83d9cd684c87d95d656c1458ef04895a7f1cbd8e`, the latest release on
2026-10-18. `gitleaks.ts` reads it, converts each Go RE2 pattern to a JavaScript RegExp, and generates a
key per rule that gitleaks would report: the pattern matches, a keyword is in the line, the secret's
entropy is above the rule's threshold, and no allowlist drops it. It checks each key against the
converted pattern before using it. Rules limited to a path (such as `*.tf`) are tested on their pattern,
since evidence text has no repo path. The one rule with no pattern, `pkcs12-file`, has no fixture; the
test prints every rule without one and fails naming the first rule whose key survives.

The converter avoids JavaScript's inline modifier groups: V8 12.9 in Node 23.9 mis-matches
`/x(?i:[a-z0-9]{5})/` against `xAb1Ab`, so case-insensitive regions are spelled out instead.

## Criterion 12: budgets

`budgets.test.ts` holds the issue's limits: storing a 5 MB screenshot under 50 ms; redaction adding under
10 ms per MB of text (a text put minus a plain put of the same bytes); and a retention pass over 30 days
of evidence (15,000 files, 500 a day) under 10 s. Per the design's rule for timing results, each takes
five runs after a warm-up and passes when all five are within the limit, fails when all five are over it
by more than the margin (the larger of 5% and the five runs' spread), and is otherwise INCONCLUSIVE. It
counts only on the reference Mac (Mac15,7, on mains power, Low Power Mode off, no thermal warning);
anywhere else, and when INCONCLUSIVE, the test is skipped with that reason, never passed.

The merge-base comparison belongs to the perf lane (`scripts/perf.mjs`, `benchmarks/budgets.json`),
which measures commands, not calls. The implementer adds three tasks, each a command that runs one
workload once against a temp root and exits 0: `evidence-put-5mb`, `evidence-redact-text` and
`evidence-retain-30d`, with `margin: 0.5`, empty `limits` (the issue names no memory budget, and a
command's p50 includes Node's start, so the per-call limits above stay in the vitest test), and an
`initialReason` saying the merge base has no evidence store. The lane then compares p50 and peak memory
with the merge base once one has these tasks.

## Not testable at base

- **AC18, the canary sweep.** It needs the hub up, then down and back up (#16), the ledger and its WAL
  (the SQLite event log, #14), deep-hook's spool (not in the base), the logs and a debug bundle the hub
  writes, and a sync. None exists at the base, and faking them would prove nothing about the real
  sweep. The store's own share of it (no scrubbed form in any file under its root) is asserted in AC2,
  AC5 and AC15, which scan every file the store wrote.

## Files

- `helpers.ts`: seeded PRNG, temp roots, file scans, PNG builder, the forms a value is printed in.
- `gitleaks.ts`: the gitleaks config reader and key generator for AC13.
- `fixtures/sample.jpg`, `fixtures/sample.mp4`: made here with ffmpeg 8.1 from its `testsrc` pattern.
- `BASE-FAILURE.txt`: the run on the base commit, where every test fails because the module doesn't exist.
- The one dev dependency added, `fast-check` 4.10.2 (MIT), is the generator the design names for
  property tests ("The generators are fast-check in TypeScript"), used by AC16.
