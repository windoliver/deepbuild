# Acceptance tests for #66: work sources, with results delivered back

Written blind by a job that saw only the issue, the design and the base commit `6aa228ce`, and nothing of any work on
#66. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding).

What was read:

- Issue #66 as of November 8, 2026: its Scope, its 18 checkbox criteria (AC1 to AC18, in the body's order), Proof and
  Depends on.
- `docs/technical-design.md`: the Extension API block; Building blocks (Source and reading, Send, Replay and clock);
  Blocks for plug-ins that do real work (Source and reading, Schedule, Send, Work source, Follow-ups, Delivery,
  Replay and a clock); Work outside a repo; Threats (Hostile text); Sessions that know about each other (safe retries,
  load); Dogfooding.
- At the base: `packages/extension-host` (`host.ts`: `readStream`, stream sources held to source@1 at install,
  `tick`/`idle`/`runs`/`schedules`/`runNow`, `enterSecret`; `sources.ts`; `sends.ts`; `runtime/deep.mjs`),
  `packages/contracts` (`work.item@1`, `work.item@2`, `send.made@1`, `checkManifest`'s sources with `reading`),
  `packages/conformance/src/slots/source.ts`, `packages/hub/src` (`ask-tasks.ts`: work items, outside text, waivers,
  the one definition ask; `github-source.ts`; `wire.ts`'s test seams), `packages/record` (the test VFS),
  `packages/asks`.
- Sibling suites for conventions: `tests/acceptance/365` (the in-process world, `helpers.ts` is cut down from it),
  `364`, `67` (`hub.ts` is cut down from it), `65`, `322` (definitions from work items), `1097` (the timing rule).

## Run

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH"
npm ci                                                 # once
npm run build --workspaces                             # the deep CLI and hub AC1 and AC5 start
scripts/lease cargo build --locked -q -p deep-hook     # the hub won't start without target/debug/deep-hook
node node_modules/vitest/vitest.mjs run --root tests/acceptance/66 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/66/tsconfig.json
```

- Node 24.22.0, macOS. Test plug-ins from outside the release run in the supervisor's platform sandbox, so the run
  needs a shell that may start it (in Claude Code, the Bash tool with its own sandbox off).
- No network, no model, no paid call, no account, no secret: every provider is a server on 127.0.0.1
  (`providers.ts`), reached only through the HTTP client the test hands the host, which refuses any other name before
  a socket. The keys the shipped sources name are test values in `worlds.ts`.
- `HOME` is a temp folder; every folder is under `/tmp/dh66-*` and removed after its file; `CLAUDE*`, `DEEP_*` and
  `AI_AGENT` are taken out of the environment; `TZ=UTC`. Processes are stopped by PID or through the supervisor run
  that started them, never by name or port.
- Time is a clock the test controls, so AC9's 24 h, AC16's 15 days and AC9's 3 h take seconds. Only AC8's 60 s uses
  the real clock.
- `--no-file-parallelism`: files start sandboxed plug-ins and hubs. The suite belongs on `scripts/lanes.mjs`'s
  one-at-a-time list, and `budgets.test.ts` on the release (byHand) lane as #67's and #365's are; the implementer
  adds both.

## The surface under test

The issue names `deep.registerSource`, `work.item@1`, `deep.send`, a standing rule per source, "Fix …", the
`work.item@1` kit and receipts, and no code API for the rest, so these tests define the smallest one they need.
Everything new is reached lazily, so each test fails on its own at the base. Everything else is the base's own: the
extension host and its seams from #364 (`now`, `secrets`, `http`), #365's schedules (`schedules`, `runs`, `runNow`,
`tick`, `idle`), `enterSecret`, the record and its test VFS, the asks core, and the hub with `deep inbox answer`,
`events.read`, DEEP_HUB_TEST_WORK and DEEP_HUB_TEST_DRAFTS.

### A work source, the package's side

A work source is a stream source whose manifest names its reading type, `{ "name": "ext.<plugin>.<name>",
"variant": "stream", "reading": "work.item@1" }`, registered with `deep.registerSource(name, source)`:

```ts
interface WorkSource {
  variant: 'stream';
  host: string;                                  // a host the grant names: every provider call is https://<host><path>
  secret?: string; header?: string; basic?: { user: string }; bearer?: true;   // #364's: the secret by handle, sent one way
  quota: { per_minute: number; per_day: number };  // calls to the provider; the hub never makes more
  delivers: 'comment' | 'chat' | 'email';        // what a delivery to this source is, which decides how it is rendered
  read?(stream, cursor, limit): Page;            // source@1's read for the kit's own stream; the test plug-ins carry one,
                                                 // so they install whether or not the host holds a work source to source@1
  /** One page of the scope's items changed at or after `since` (ISO 8601), from `cursor` (null: the first page). */
  list(ctx: Ctx, q: { scope: string; since: string; cursor: string | null; limit: number }):
    Promise<{ items: { id: string; scope: string; created: string; updated: string; mention: boolean }[]; cursor: string | null }>;
  /** One item read on its own: the item and every comment, edit or status on it, or why it can't be read. */
  item(ctx: Ctx, q: { scope: string; id: string }):
    Promise<{ events: SourceEvent[] } | { failed: 'deleted' | 'not found' | 'forbidden' | 'error'; status?: number }>;
  /** A delivery into the item's thread; the plug-in makes the provider keep `key` as a marker. Throwing: not sent this time. */
  deliver(ctx: Ctx, d: { scope: string; id: string; key: string; text: string }): Promise<{ outcome: 'sent' } | { outcome: 'gone'; why: string }>;
  /** Whether the thread holds the send key's marker; null when the provider keeps none. */
  find(ctx: Ctx, d: { scope: string; id: string; key: string }): Promise<boolean | null>;
}
interface SourceEvent {
  id: string;                  // the event identity: the provider's, or one the source derives (an edit gets a new one)
  kind: 'item' | 'comment' | 'edit' | 'status';
  at: string;                  // ISO 8601
  marker: string | null;       // the send key this event carries, when it is one of DeepBuild's deliveries
  mention: boolean;            // it mentions you
  data: WorkItem;              // a work.item@1 reading; `body` comes as the text, and the hub keeps it as a handle
}
interface Ctx { fetch(r: { method: string; path: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; headers: Record<string, string>; body: string }> }
```

`ctx.fetch` is the hub's call: through its HTTP client, to the source's host, the secret added by handle, under the
source's quota. A list entry's `mention` says a new notice or mention of you came on that item since `since`.

### The host's side (`@deepbuild/extension-host`'s `ExtensionHost` gains)

```ts
type Role = 'owner' | 'collaborator' | 'outside';
type Verdict = 'PASS' | 'FAIL' | 'BLOCKED' | 'INCONCLUSIVE' | 'INVALID';
interface WorkItem { source_id: string; link: string; title: string; body: string; criteria: string[]; authors: { handle: string; role: Role }[]; updated: string }
interface WorkEvent { id: string; kind: 'item' | 'comment' | 'edit' | 'status'; at: string; reading: WorkItem }
interface WorkTask { task_ref: string; source: string /* the work source's handle */; id: string /* its item's source_id */; link: string; title: string; criteria: string[]; opened: number; ended: number | null }
interface WorkPage {
  on: boolean;
  position: string | null;                                        // the saved read position
  skipped: number;                                                // malformed items skipped
  dropped: { id: string; why: 'deleted' | 'not found' | 'forbidden'; at: number }[];
  failing: { id: string; error: string; since: number }[];       // items whose reads fail, `since` the first failed read
  refused: { event: string; why: string }[];                      // changed input under a reused identity
}
interface DeliveryRow {
  key: string; task_ref: string; source: string; thread: string;  // thread: the item's ID
  outcome: 'queued' | 'waiting' | 'sent' | 'not sent' | 'unknown' | 'gone';   // waiting: on its authority ask
  cause: string | null; ask: string | null; rule: string | null; at: number | null;  // at: when it was sent, or ended gone
}
interface WorkResult { verdict: Verdict; summary: string; requirements: { id: string; text: string; verdict: Verdict; evidence: string[] }[]; receipt: string }
interface WorkKitFixture { scope: string; items: string[]; roles: Record<string, Role> }

/** On the trusted path: switches a loaded work source on over a scope. Its handle, which is also its schedule's name. */
addWorkSource(connection: Connection, spec: { source: string; scope: string; every: number }): Promise<string>;
removeWorkSource(connection: Connection, handle: string): Promise<void>;
/** On the trusted path: your standing rule for the source's deliveries ("reply in the thread it came from"). Its handle. */
setWorkRule(connection: Connection, handle: string, rule: { sentence: string }): Promise<string>;
/** "Fix <id>": the item read now by its ID through the added sources, whenever it was made; its task opened, or the open one. */
fix(connection: Connection, id: string): Promise<WorkTask>;
workTasks(): Promise<WorkTask[]>;
/** The events taken in on a task's item, each once. */
workEvents(task_ref: string): Promise<WorkEvent[]>;
/** The task ends, as when it settles. */
endTask(connection: Connection, task_ref: string): Promise<void>;
workPage(handle: string): Promise<WorkPage>;
/** Records a delivery of the result to the task's thread and returns its send key; it never calls the provider itself. */
deliverResult(task_ref: string, result: WorkResult): Promise<string>;
deliveries(): Promise<DeliveryRow[]>;
/** The work.item@1 kit on a loaded work source, against its provider. */
workKit(source: string, fixture: WorkKitFixture): Promise<{ verdict: 'PASS' | 'FAIL'; failures: string[] }>;
```

What the tests hold the host to:

- **Runs.** A work source runs on its schedule (`every` ms) by the hub's timer (`tick`), and on `runNow(YOU, handle)`;
  its runs are #365's (`runs(handle)`, `schedules()`). `since` is the switch-on time on the first run, then the saved
  position.
- **The switch-on.** An item whose `created` is before the switch-on never becomes a task on its own; `fix` still
  starts one. A page read while the source is being removed makes no task.
- **Tasks.** Each item becomes one task: `id` its item reading's `source_id`, `link` that reading's link, `criteria`
  its criteria in order.
- **The read position** is saved in the same append as the items it covers, a time position 5 s before the newest
  `updated` read.
- **Pages.** A page holding an item whose `scope` isn't the scope asked, or whose next cursor repeats one given before
  in the run, is refused: no task from it, and the run is INCONCLUSIVE with its `cause` naming the item's ID or the
  word `cursor`. An event whose `data` isn't a valid work.item@1 is skipped and counted in `skipped`, and fails no run.
- **Event identity.** An identity taken once has no second effect; the same identity with other input is refused and
  listed in `refused`.
- **Failed item reads.** `deleted` drops the item at once (`dropped`, `at` the time of that read); `not found` and
  `forbidden` keep it in `failing` and read it again each run until 24 h after its first failed read, when it is
  dropped; any other failure stays in `failing` and is read again next run. No item's read fails a run or pauses the
  schedule. An item that reads again goes on from its own read position.
- **Watching.** An item is read while its task is open, then until 14 days after the later of its last update and
  the task's end; after that only a list entry with `mention: true` brings it back.
- **Markers.** An event whose `marker` is one of the hub's send keys is never taken in.
- **Deliveries** go out from the hub's timer. Under your rule for the source, with no ask; with none, one authority
  ask through the asks core, `waiting` until your yes (it goes once) or your no (`not sent`). A source event never
  answers an ask. The hub renders the text by `delivers`: for `chat`, the first line holds the verdict word, the whole
  is at most 100 words and holds `result.receipt`; for `comment` and `email`, the structured receipt, with one line per
  requirement holding its `id` and its verdict. `{ outcome: 'gone' }` ends the delivery `gone` with `cause` the why and
  `at` the time, never tried again, never a FAIL and never a pause of the schedule; a throw is tried again at later
  ticks. A task's deliveries to one thread go in the order recorded, a later one waiting while an earlier one isn't
  settled. A delivery's claim is durable before its request; one whose answer never came reads, at the next start,
  `sent` when `find` says true, `not sent` and then goes once when false, `unknown` only when null.
- **The kit.** `workKit` reads the scope from `1970-01-01T00:00:00.000Z`, every page and every listed item, through the
  hub. FAIL names a repeated next cursor (the word `cursor`), an item from another scope (its ID), an author whose
  role isn't `roles[handle]` (the handle) and an item of `items` it didn't read (its ID); otherwise PASS with
  `failures: []`. Authors `roles` doesn't name aren't judged.

### The shipped sources (`packages/sources/<name>`)

Each is a package folder `install({ from })` takes (the tests copy it and set its digest), with one source whose
reading is work.item@1. The tests take the source's name from its manifest and the package's ID from the install.

- **`packages/sources/linear`**: secret `linear_key`; host `api.linear.app`, `POST /graphql` with the key in the
  `Authorization` header. Scope: a team key (`LIN`). Item IDs are issue identifiers (`LIN-42`), the item reading's
  `source_id` too; `link` is the issue's `url`; `criteria` are the `- [ ]` lines under the description's
  `### Acceptance criteria` heading, in order; each comment is a reading of its own. An author's handle is the
  Linear user's `displayName`; the role comes from the team's membership: a member reads owner or collaborator, anyone
  else outside.
- **`packages/sources/gmail`**: secret `gmail_token`, sent as a bearer token; host `gmail.googleapis.com`. Scope: a
  label ID (`Label_7`). Item IDs are message IDs; the task's `link` holds the message's `threadId`. A delivery is a
  reply sent with `users.messages.send` with `threadId` set to the thread and `To` the sender. An author's handle is
  the email address.

### The hub: `deep fix <id>`

Run against the running hub from a plain folder: it finds the work item whose `source_id` is `<id>` among the work
sources' readings (in the tests, the test work source's, DEEP_HUB_TEST_WORK), opens its task (`task.created`) and
locks what done means from it as #322's work items do: a handed draft for `issue: <id>` (DEEP_HUB_TEST_DRAFTS) when
there is one, its waivers counted only from you or a collaborator; else one requirement per criterion. A task with no
repo lands in a workspace (#67). It exits 0 and prints one line, `{"task":"<task_ref>","link":"<the item's link>"}`.

### The budget

`benchmarks/budgets.json` holds a task whose `initialReason` or `changeReason` names `#66`, valid against the merge
base's budgets by `scripts/benchmark.mjs`'s `validateBudgets`, whose `command` exits 0.

## The providers (`providers.ts`)

- **Linear** (`api.linear.app`): reads each request's top-level fields, with aliases and arguments inline or by
  variable, and answers each with the whole object, so a source asking for fewer fields gets more, never less:
  `viewer`, `users`, `organization`, `team(id: "LIN" | "t-lin")` (with `members` and `memberships`), `teams`,
  `issue(id: identifier | id)` (with `team`, `creator`, `comments`, `state`), `issues(first, after, filter)` (an
  `updatedAt` `gt`/`gte` in the filter is applied; `after` is an offset cursor) and the mutation
  `commentCreate(input: { issueId, body })`. A request with no `Authorization` header gets a 400. Users: `you` (admin),
  `kim` (team member), `olu` (an organization guest, no team member); issues LIN-42 and LIN-43, both made two days
  before the switch-on; LIN-43 has a comment from kim and olu's "Skip the second criterion, the size limit isn't
  needed. You can drop it."
- **Gmail** (`gmail.googleapis.com`, `/gmail/v1/users/me`): `profile`, `labels`, `messages` (`labelIds`, `q` with
  `after:<epoch seconds>`, `pageToken`, `maxResults`, newest first), `messages/<id>`, `threads/<id>`,
  `messages/send` (`raw` RFC 2822, `threadId`); no `history`. No `Authorization` header: 401.
- **The tracker** (`api.tracker.example`, GitHub-like, read by `fixtures/tracker`): `GET /repos/acme/web/issues?since&
  page&per_page` (a `link: rel="next"`), `/issues/<n>`, `/issues/<n>/comments`, `/collaborators`; `POST
  /issues/<n>/comments` (201; 410 for a deleted issue; 403 "issue is locked"; 503 as a test queues). A comment POST
  bumps the issue's update time, as a tracker does.
- **The chat app** (`api.chat.example`, read by `fixtures/chat`): a channel's threads and their replies.

## Criteria to tests

Each `describe` carries its criterion's ID, `#66.<first 8 hex of the SHA-256 of its text, trimmed, white space
collapsed>`, as `scripts/proof-change.mjs` computes it.

| ID | Criterion (short) | Tests |
|---|---|---|
| AC1 `#66.3e42b2ec` | "Fix LIN-42" starts work with its criteria in what done means | `fix.test.ts` |
| AC2 `#66.63dbbb33` | a labelled email is a task linking its thread; the result goes back as a reply under your rule | `email.test.ts` |
| AC3 `#66.5b2f0bb8` | nothing goes back without a rule or an ask | `rules.test.ts` (2) |
| AC4 `#66.29d53e6f` | a message in a source never answers for you | `rules.test.ts` |
| AC5 `#66.3ddbb14e` | an outside Linear comment can't waive; the definition waits for one answer | `fix.test.ts` |
| AC6 `#66.c02d2c19` | the outside commenter is outside, from membership; the all-collaborators reader fails the kit, naming the author | `kit.test.ts` (2) |
| AC7 `#66.79249ba8` | event identity: real update processed, resend no effect, changed input refused | `identity.test.ts` |
| AC8 `#66.61304a77` | budgets: the perf lane, the quota, item to task within 60 s | `budgets.test.ts` (3) |
| AC9 `#66.839c6774` | 410 and 404 among 20; 24 h; never pauses; 404 for 3 h reads on | `failed.test.ts` (2) |
| AC10 `#66.c521a2ac` | 400-message backlog makes no task; a new one does; Fix an old one; removal mid-page | `backlog.test.ts` (2) |
| AC11 `#66.c9794944` | killed around the run's writes: nothing lost or doubled; the item stamped 3 s early | `crash.test.ts` (2) |
| AC12 `#66.64143d81` | a delivery isn't read back | `markers.test.ts` |
| AC13 `#66.ae3a36b9` | 410 and locked deliveries end gone, once, no FAIL | `gone.test.ts` |
| AC14 `#66.91ad44c4` | a delivery killed after its request settles by its marker | `unknown.test.ts` (2) |
| AC15 `#66.e73c1ce6` | two deliveries to one thread go in order through 503s | `order.test.ts` |
| AC16 `#66.abf37817` | 3 days taken in; 15 days not read; a mention brings it in | `watch.test.ts` |
| AC17 `#66.a51b9fa2` | malformed item skipped and counted; repeated cursor and foreign item INCONCLUSIVE and fail the kit | `pages.test.ts` (3) |
| AC18 `#66.c7bb08f1` | chat reply at most 100 words with the verdict line and receipt link; issue comment per requirement | `fits.test.ts` |

## Wrong programs

The planted readers run on the real host: `fixtures/linroles` (AC6, every author a collaborator) and
`fixtures/tracker` with `{"plant":"repeat-cursor"}` and `{"plant":"foreign-item"}` (AC17). The wrong hubs and sends
are models beside the hub in `twins.ts`, each reading or writing the same local provider at the same point of the
scenario, and judged by the same function as the real hub (`judges.ts`):

| Twin | Criterion | How it fails |
|---|---|---|
| `failsRunOnItem` | AC9 | the run ends FAIL; the judge names `acme/web#5` |
| `dropsAtOnce` | AC9 | issue 9 dropped at its first failed read; the judge names `acme/web#9` |
| `backlogAsTasks` | AC10 | every label message a task; the judge names 400 |
| `readsOwnDelivery` | AC12 | the delivery's comment comes back; the judge names the send key |
| `triesAgain`, a paused schedule | AC13 | the judge names the send key |
| `leavesUnknown` | AC14 | the judge names the send key |
| `sendsSecondFirst` | AC15 | the judge names both keys |
| `postsFullReceipt` | AC18 | the judge names the planted send's key |

## Readings where the issue leaves a choice

- **"Fix LIN-42" is two halves.** The design has the Linear source read the issue on the extension host and the
  hub's kernel lock what done means; the hub has no route yet for a plug-in source's readings in a test, so AC1 and AC5
  hand the hub the readings the shipped Linear source gave through DEEP_HUB_TEST_WORK, the hub's test work source.
  The hub half is `deep fix <id>`, which the caller of this job named.
- **"Outside the project"** in Linear is no member of the issue's team. Linear has no acceptance-criteria field, so
  the criteria are the description's checklist under its heading, as this repo writes GitHub issues.
- **AC5's waiver** reaches the kernel as the drafting job's output (`waives`), as in #322's suites; what the tests add
  is that the Linear source reads olu as outside and `deep fix` opens the task.
- **AC11's two kill points** are every point between two of the run's syncs: a hub that writes items and position in
  one append has no point between them, and one that doesn't is caught whichever order it writes them in. Files the
  host wrote before the cut stay, as a disk keeps them.
- **AC13's "pauses the schedule"** twin is the schedule's row read as paused; the hub's own row is read the same way.
- **AC16's "not read by the schedule"** is no item read of issue 61 after the comment; the list call itself is the
  source's run, not a read of the item.
- **AC8's merge base** has no work sources; the comparison is the perf lane's. The quota is a count and holds on any
  machine; the 60 s is a timing and counts only on a reference Mac, unloaded, else INCONCLUSIVE.

## Not tested, and why

- **The Proof's end-to-end task worked to done** with its deliveries in its receipt: no criterion names it beyond
  AC1, AC2 and AC5's parts; a PR should show it as the Proof says.
- **Jira, GitLab, a calendar event, a folder and the app's box**: no criterion names them.
- **Follow-ups reaching the session that owns the thread (#1029)**: that issue's.
- **A delivery queued while its source is off waits; switching a source on again starts from then; "delivered or
  acknowledged is kept as evidence"**: Scope lines with no criterion.

## How far these tests were checked

Type-checked with this tsconfig, and run once at the base (`BASE-FAILURE.txt`): all 28 fail on the missing surface,
after the test plug-ins installed and loaded. Never run green, since no implementation exists: the fakes' answers to a
real Linear or Gmail source, the twins and the hub half of AC1 and AC5 (`deep fix`) have run against nothing yet.

## Files

- `helpers.ts`: criteria IDs, temp folders, the clock, the world, the host and its seams, the hub's stop and start,
  local providers and the routed client, packages, clock steps; the surface's types (`WorkMethods`).
- `providers.ts`: the four recorded providers. `worlds.ts`: a world per provider.
- `hub.ts`: the real hub, `deep`, the record through the socket (AC1, AC5).
- `judges.ts`, `twins.ts`: the criteria's judges and the wrong programs.
- `fixtures/tracker`, `fixtures/chat`: test work sources; `fixtures/linroles`: AC6's planted reader. Their code
  carries a `.fixture` suffix so Vitest and tsc skip it.
- The tests: `fix`, `email`, `rules`, `kit`, `identity`, `budgets`, `failed`, `backlog`, `crash`, `markers`, `gone`,
  `unknown`, `order`, `watch`, `pages`, `fits` `.test.ts`.
- `BASE-FAILURE.txt`: the run at the base.
