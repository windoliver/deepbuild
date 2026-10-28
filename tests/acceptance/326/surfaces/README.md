# Acceptance tests for #326, criterion group "surfaces": notifications, and every state on every surface

These tests were drafted blind from issue #326 (its text as of October 27: Scope, the seven criteria, Proof, the
Oct 9 additions), `docs/technical-design.md` (One hub per user, a tiny hook client, and extensions in-process: the
DeepBuild app row, with the menu bar's one count, notifications and the question card; First-party extensions that
ship on by default: the view row, with the one count, notifications, sounds, "says done" and the return card;
States people see; Panels and devices: Device gate and capture, Needs-you view, Replica; An agent says it's done:
the verdict in the chat, Stalled claims; Threats: a plug-in that plays sound; How we know version 0 works), the
`packages/contracts` schemas and fixtures for every event kind the records use, the clean look
(`crates/deep-canvas-marks/looks/clean.json`), `packages/hub/src/status.ts` (`deep status`'s words), the record's
projections (`packages/record/src/projections.ts`: claim handles, `last_seen`), the base's app and replica
(`crates/deep-app/src/{lib,views,events,record}.rs`, `crates/deep-replica/{src/*.rs,headless.rs}`), gpui's test
clock (`vendor/gpui-pre/src/app/headless_app_context.rs`, `executor.rs`) and the conventions of
`tests/acceptance/338`, `tests/acceptance/34` and `tests/acceptance/392`, at base commit `debda22`, which has none of
#326. Per AGENTS.md the implementing agent doesn't edit them; a dispute goes to a blind redraft by this job.

This group holds criteria 2 and 3 and nothing else; #326's other criteria are other groups' (`../setup`,
`../panels`).

## The surface (my choice, since the issue names none)

Everything the tests reach is at the root of the replica crate, `deep_replica`, or in its `kit` module beside the
base's `needs_you`, so the app's own layout under it stays the implementer's. `NOW`, `repo_root`,
`snapshot::Snapshot` and `kit::Verdict` are the base's and keep their meaning. The notifier and its sound live in
the app shell (the design keeps notifications there); `deep_replica` re-exports them.

```rust
// crates/deep-replica, the crate root
pub use deep_app::<the app's module>::{Notifier, Sound, NOTIFY_AFTER};

pub const NOTIFY_AFTER: Duration;            // the app's notifier waits this long: 1 s (a re-export)
pub struct Notifier;                         // a re-export
impl Notifier { pub fn new(after: Duration) -> Notifier }   // the app's own is Notifier::new(NOTIFY_AFTER)
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Sound { Question, /* the notice sound and any other the implementer keeps */ }

#[derive(Clone, Debug)]
pub struct Posted {                          // one notification, as the OS was asked to show it
    pub device: usize,                       // which device posted it, 0..n
    pub ask: Option<String>,                 // the ask it carries, `ask:<id>`; None for a notice
    pub session: String,                     // the session it is about, its bare id as in a fixture line
    pub at: u64,                             // when it was posted, ms since the epoch on the virtual clock
    pub text: String,                        // its title and body, as shown
    pub sound: Option<Sound>,                // the sound it plays on that device, if any
}

#[derive(Clone, Debug)]
pub struct Seen {                            // one surface's text snapshot for the record's one session
    pub surface: String,                     // "sidebar-row", "line", "return-card", "verdict-line", "menu-bar", "notification"
    pub text: String,                        // every word the surface shows, in reading order
    pub entry: String,                       // the status-map entry its status mark draws: "idle", "running", "pass", …
    pub glyph: String,                       // the glyph that mark draws
}

pub struct Replica;                          // the app headless on gpui's virtual clock
impl Replica {
    pub fn open(fixture: &Path) -> Replica;
    pub fn open_devices(fixture: &Path, devices: usize) -> Replica;
    pub fn with_notifier(fixture: &Path, notifier: Notifier) -> Replica;
    pub fn append(&mut self, session_id: &str, event: serde_json::Value);
    pub fn advance(&mut self, by: Duration);
    pub fn now(&self) -> u64;
    pub fn focus(&mut self, device: usize, session: Option<&str>);
    pub fn notifications(&self) -> Vec<Posted>;
    pub fn click(&mut self, posted: &Posted);
    pub fn card(&self, device: usize) -> Option<String>;
    pub fn menu_bar(&mut self, device: usize) -> String;
    pub fn surfaces(&mut self) -> Vec<Seen>;
    pub fn window(&mut self) -> Snapshot;
}

// crates/deep-replica, `kit`, beside the base's needs_you
pub fn notifications(replica: &Replica) -> Verdict;
pub fn states(row: &str, seen: &[Seen]) -> Verdict;
```

What each does:

- **`Replica::open`** opens the app headless on gpui's virtual clock, starting at `deep_replica::NOW`
  (1,800,000,000,000 ms, which every fixture's times are written against), over the record at `fixture`: lines of
  `{"session_id", "event"}` in log order, the base's fixture format (`deep_app::events::Fixture`). One device, its
  window open, the app's own notifier. The record is history: an ask in it showed before the clock started.
- **`open_devices`** is `n` paired devices of one hub: each its own app, window and menu bar, fed the same record
  and the same virtual clock. **`with_notifier`** is `open` with the given notifier in place of the app's.
- **`append`** delivers one event to every device's app through its one record reader at the clock's now. The
  replica assigns the next `log_pos`, as the hub would; the tests set `ts` to `now()`. An ask "shows" when its
  `ask.created` is appended.
- **`advance`** moves the virtual clock forward and runs what comes due on the way, at its due time. (gpui's
  `BackgroundExecutor::run_until_parked` jumps the clock to the next timer; `HeadlessAppContext`'s doesn't.)
- **`focus(device, Some(session))`**: that device's focused window shows that session's page; `None`, no session's.
- **`notifications`**: every notification posted so far, on every device, oldest first. **`click`** clicks one on
  its device; **`card(device)`** is the ask whose question card is open there. **`menu_bar(device)`** is the
  menu-bar item's title: the count alone, as the base's `deep_app::menu_bar_title` already is.
- **`surfaces`**: what each of the criterion's six surfaces shows for the record's one session, read from what the
  replica drew: the sidebar row, the line and the return card from the window's drawn tree; the verdict line as
  the text it sends to the chat; the menu bar's title and its menu; the notification the app would post in that
  state. Exactly one `Seen` per surface.
- **`window`**: device 0's window as the base's text snapshot (`snapshot::from_observed`), with the record's one
  session's page open beside the sidebar and the line.
- **`kit::notifications`** judges a run: every notification about an ask was posted at least `NOTIFY_AFTER` after
  the ask showed, while it was still open, and not for a session open in that device's focused window, and an ask
  still open a second after it showed, from a session nobody is looking at, was notified once. A failure's `names`
  holds the ask's handle.
- **`kit::states`** judges a view's snapshots against a row of States people see, `row` being the table's word:
  each surface shows the word with its extra, never a word that doesn't name the row, and draws the row's
  status-map entry with the look's glyph. A failure's `names` holds the surface's id and the row's word.

## Fixtures

`fixtures/`, written by this job before any implementation, every event checked against its kind's published
schema (BASE-FAILURE.txt). Session ids, claim, task and ask ids are ULID-shaped; a claim's handle is
`claim:<its claim.made's id>`, an ask's `ask:<its ask.created's id>`, as the record has them.

| File | Holds |
|---|---|
| `<row>.events.jsonl`, one per row | one session (`~/src/shop`, task "Cart totals") in that row's state at `NOW` |
| `notify.events.jsonl` | two sessions, `…N01` and `…N02`, each with a task, and nothing asked |
| `live.json` | templates of the events the notifier tests append: `ask.created@3`, `ask.answered@1`, `agent.stop@1`, `claim.made@1`, `run.started@1`, `run.finished@1`, `verdict.made@1` (PASS), `notice.subscribed@1`, `notice.sent@1` |

The rows (`<row>` is the file stem; the record's events after `session.start` and `task.created`):

| Row | Word | Entry | The record | Extra the tests read |
|---|---|---|---|---|
| `queued` | queued | idle | a task the agent hasn't started: no turn, no tool call | |
| `working` | working | running | `session.attention` working, a `tool.before` 10 s ago | |
| `says-done` | says done | running | three clean runs of `unit`, 4 min each, on an earlier claim with its PASS; then a stop, a new claim and a `unit` run that started at `NOW` | the checks' expected time, `4 min` |
| `pass` | PASS | pass | a stop, a claim, a passed run, verdict PASS | |
| `sent-back` | sent back | fail | … a failed run, verdict FAIL, `claim.sent_back` round 1 | `sent back 1 of 3` |
| `blocked` | BLOCKED | blocked | … a missing run, verdict BLOCKED | |
| `invalid` | INVALID | invalid | … a run that ran nothing, verdict INVALID | |
| `inconclusive` | INCONCLUSIVE | inconclusive | … a stopped run, verdict INCONCLUSIVE | |
| `needs-you` | needs you | needs_you | an open unblock ask | |
| `stale` | stale | stale | … verdict PASS, then `verdict.stale` (commit moved) | |
| `quiet` | quiet | idle | its last hook event 2 h before `NOW`, and `session.attention` unknown at that moment | when it was last seen, `2 h` |

The tests set these fields of a `live.json` template and nothing else: every event's `id` and `ts` (and `seq`
where it has one); `ask.created`'s `data.deadline` (two days on) and `data.unblocks`; `ask.answered`'s `subject`;
`agent.stop`'s `subject`; `claim.made`'s `data.task_ref`; `run.started`'s `data.run` and `data.claim`;
`run.finished`'s `data.run`; `verdict.made`'s `data.verdict`, `data.claim` and each requirement's
`runs.counted`; `notice.subscribed`'s `data.key`; `notice.sent`'s `data.notice` and `data.cites`. Every ask asks
"Create a registry token for the publish check?" with the default `wait`, labelled "Leave it blocked".

To check the fixtures again, from the checkout with `packages/contracts/dist` built:

```sh
node --input-type=module -e "
import { readFileSync, readdirSync } from 'node:fs';
const { validate } = await import('./packages/contracts/dist/index.js');
const dir = 'tests/acceptance/326/surfaces/fixtures';
let bad = 0, n = 0;
for (const f of readdirSync(dir)) {
  const text = readFileSync(dir + '/' + f, 'utf8');
  const events = f === 'live.json' ? Object.values(JSON.parse(text)) : text.split('\n').filter(Boolean).map((l) => JSON.parse(l).event);
  for (const e of events) { n++; const r = validate(e.kind + '@' + e.v, e); if (!r.ok) { bad++; console.log(f, e.kind, JSON.stringify(r.issues)); } }
}
console.log(n + ' events, ' + bad + ' invalid'); process.exit(bad ? 1 : 0);"
```

## How to run

```sh
cargo test --locked -p deep-replica --test acceptance_326_surfaces            # all 22 cases
cargo test --locked -p deep-replica --test acceptance_326_surfaces -- ac3_     # the cases whose names hold ac3_
```

The target is `surfaces.rs`, wired by one `[[test]]` entry this job added to `crates/deep-replica/Cargo.toml`
(`name = "acceptance_326_surfaces"`, `harness = false`). Like the replica's own `headless` suite it has no libtest
harness, so every case runs on the main thread, where AppKit wants the offscreen renderer; it prints libtest's
`test <name> ... ok|FAILED` lines and exits non-zero on any failure. A filter that names no case runs nothing and
exits 1 (INCONCLUSIVE). Off macOS the target prints INCONCLUSIVE and exits 1: the replica runs on macOS only, and
unrun is never passed. Until #326 lands, the target doesn't compile (BASE-FAILURE.txt), so a `cargo test
--workspace` or `cargo clippy --workspace --all-targets` lane fails on it, as it does on `../panels`'s targets.

## Criteria, tests and wrong programs

IDs are the first 8 hex digits of SHA-256 of each criterion's text, as `tests/acceptance/48/README.md` computes them.

| ID | Criterion clause | Tests (in surfaces.rs) | Wrong programs it fails on |
|---|---|---|---|
| `#326.47455776` | On a virtual clock, an ask answered 0.9 s after it shows fires no notification | `ac2_an_ask_answered_0_9_s_after_it_shows_fires_no_notification`: nothing posted by 0.9 s; answered then; nothing posted by 6 s; `kit::notifications` passes the run | a notifier that fires at once; one that fires at 1 s without checking the ask is still open |
| | and one still open 1 s after fires exactly one | `ac2_an_ask_still_open_1_s_after_it_shows_fires_exactly_one`: none at 0.999 s, exactly one at 1.000 s and still one at 11 s, posted no earlier than a second after it showed; the kit passes | a notifier that fires at once (it posts at 0 s); one that fires twice |
| | an ask from the session whose page is open in the focused window fires none | `ac2_an_ask_from_the_session_open_in_the_focused_window_fires_none`: S1's page focused; S1's ask posts nothing while S2's, raised at the same moment, posts once; the kit passes | a notifier that ignores focus; one that silences every session while any page is focused (the S2 control) |
| | a notifier that fires at once fails, naming the ask | `ac2_a_notifier_that_fires_at_once_fails_naming_the_ask`: `Replica::with_notifier(…, Notifier::new(Duration::ZERO))`, one ask answered at 0.9 s and, in a second run, one still open; the planted notifier is shown to post before a second, and `kit::notifications` fails naming that ask; `NOTIFY_AFTER` is 1 s | the planted notifier itself (it must fail); a kit that passes anything; one that names no ask or another |
| | finished work makes no sound and never sounds like a question | `ac2_finished_work_makes_no_sound_and_never_sounds_like_a_question`: two sessions finish work (a stop, a claim, a passing run, PASS); you asked for a notice on S2's task only, and its `notice.sent` follows. S1's work posts nothing; S2's notice posts once, with no sound; the same run's question sounds `Sound::Question` (so a replica that never sounds can't pass) | a notice that sounds like a question; finished work that notifies with no notice asked; finished work with any sound |
| | only one device plays a sound | `ac2_only_one_device_plays_a_sound`: two devices; for each of two asks, at most one post a device, and exactly one post with a sound, the question's | every device sounding; none sounding; a device posting twice |
| `#326.6cfad91f` | For each row of States people see, a fixture record in that state renders in a replica on the sidebar row, the line, the return card, the verdict line, the menu bar and a notification. Each text snapshot shows that row's word with its extra … and the drawn status entry is that row's | `ac3_<row>_on_every_surface`, eleven cases: the replica's clock starts at `NOW`; one `Seen` per surface; on each, the row's word (lower-case words may start with a capital), the extra (`sent back 1 of 3`; `4 min`; `last seen` then `2 h`, spaces aside, so "2h", "2 h" and "2 hours" read), none of the row's never-call-it words, the row's entry and the clean look's glyph for it; the window's snapshot shows the word and draws the glyph and holds no never-call-it word; `kit::states` passes the app's own surfaces | PASS for a stale verdict; done for says done; "sent back" with no round; says done with no time; quiet with no last-seen; another row's entry or glyph; "in progress", "proven", "passed", "failed", "waiting on you"; a surface missing or read twice |
| | A view that shows PASS for a stale verdict … fails, naming the surface and the row | `ac3_a_view_that_shows_pass_for_a_stale_verdict_fails_naming_the_surface_and_the_row`: on each of the six surfaces in turn, the stale record's snapshot is planted with PASS in place of stale (the pass entry and ✓) and, separately, PASS beside stale; the tests' own check rejects each, and `kit::states("stale", …)` fails naming that surface and "stale" | the planted views themselves; a kit that passes anything; one that names nothing, the wrong surface or not the row |
| | or 'done' for says done, fails, naming the surface and the row | `ac3_a_view_that_shows_done_for_says_done_fails_naming_the_surface_and_the_row`: each surface's says-done snapshot with "says done" made "done" (the case asserts the surface showed "says done" first); the tests' check rejects it, and the kit fails naming the surface and "says done" | as above |
| | (the drawn status entry is that row's) | `ac3_a_view_that_draws_another_rows_status_entry_fails_naming_the_surface_and_the_row`: for every row and every surface, the snapshot planted with the next entry in the status map's order and its glyph; the tests' check rejects each, and the kit fails naming the surface and the row | as above, across all 66 row-surface pairs |

The issue's Scope, in the replica:

| Scope sentence | Test | Wrong programs |
|---|---|---|
| notifications carry the ask's question and default | in `ac2_…_fires_exactly_one`: the post's text holds the question and "Leave it blocked" | a notification with the title alone |
| and open its card (and, by design, answer nothing) | `scope_a_notification_opens_its_asks_card_and_answers_nothing`: clicking it opens that ask's card on that device, and the menu bar still counts it | a click that answers; a click that opens nothing |
| One count of what needs you, the same in the menu bar … | `scope_one_count_the_same_on_every_device`: two devices both count 3 open asks, and both 2 after one answer | a device that counts on its own; an answer that clears one device only |

Every wrong program above that the implementation can't hold (the planted notifier and the planted views are in
surfaces.rs; the rest would be bugs in the app) was run against a stand-in kept outside the checkout; its matrix
is in BASE-FAILURE.txt.

## What the base commit has

At `debda22` the target doesn't compile: `deep_replica` has no `Replica`, `Seen`, `Posted`, `Notifier`, `Sound` or
`NOTIFY_AFTER`, and `kit` has no `notifications` or `states` (5 errors, all naming the missing surface). Every one
of the 22 cases needs `Replica`, so all 22 fail for it. Against the stand-in the file compiles, passes 22 of 22 on
a right program and fails each wrong program on the cases meant to catch it, with clippy `-D warnings` and rustfmt
clean. `BASE-FAILURE.txt` holds both runs.

## Not covered here

- **The same count in the status line and `deep status`.** The status line is deep-hook's forwarder into Claude
  Code and `deep status` reads the hub; neither runs in the replica. Only the menu bar's count, on two devices, is
  tested here. A follow-up would compare all three on one hub.
- **Status colors mean status only, and data colors never use them.** These tests read the entry and glyph a
  surface draws, not its pixels; the look's status colors and the status guard are #392's.
- **Which device sounds.** Only that exactly one does; the design doesn't say which.
- Criteria 1 and 4 to 7: other groups'.

## Assumptions a redraft may revisit

- **I picked every name above**: the six surface ids, `Seen`, `Posted`, `Sound`, the `Replica` methods, and the
  two kits' signatures and `names` contents. `Notifier::new(after)` is the one seam for a wrong notifier: the
  criterion's "fires at once" is the same notifier with no wait. The kits are the implementer's, as `needs_you` is;
  the tests also judge every surface and every run themselves, so a kit's word is never the only evidence.
- **"Shows" is when `ask.created` reaches the app**, and the second is counted on the virtual clock from there. A
  post at exactly 1.000 s counts as "1 s after"; one at 0.999 s doesn't.
- **"Finished work makes no sound"** is read with the Oct 9 addition: finished work notifies only as a notice you
  asked for, and by default with no sound at all. So the test asks for one notice (on a verdict, `notice.sent`
  citing it) and requires it to post once, silently. A redraft could let a finished-work notice sound, as long as
  it isn't the question's sound.
- **Two devices in one replica.** The hub's choice of the sounding device isn't in the replica; the replica holds
  both apps on one clock and record, so whatever decides it is under test.
- **The text rules.** Words match whole; a lower-case word may begin with a capital at a sentence start;
  never-call-it words match whole and in any case, and "done" is allowed only as "says done". For stale, "pass" in
  any case, "passed" and "proven" are refused on every surface, since a stale verdict's surface shows its state, not
  the PASS it went stale from. A chrome label in the window holding one of those words would fail the window check.
- **The extras.** "1 of 3": three send-backs is where Stalled claims stops sending back. "4 min": the median of the
  check's last clean runs, three runs of 240 s each, with the new run started at `NOW` so expected and remaining
  time agree. "2 h": the record's `last_seen` is its newest event's `ts`, and the quiet record's newest events are
  both 2 h old, so a reader of either says 2 h.
- **Which record is "in that state".** `queued` is a task created with no turn started; `working` comes from
  `session.attention` and a tool call; `quiet` from `session.attention` unknown, as `deep status` reads quiet;
  `stale` from `verdict.stale`. A redraft may read `quiet` from `archive.quiet` instead, which is per agent, not
  per session.
- **The glyphs** are the clean look's (`crates/deep-canvas-marks/looks/clean.json`), read at run time, as the
  app's look. A different shipped look would change only which glyph each entry must show.
- **Planted views are planted at the snapshot**: what a wrong view would show on that surface. Three of the six
  surfaces (the menu bar, the notification, the verdict line) are the shell's and can't be replaced by a panel, so
  one form serves all six. A redraft may also plant script panels for the sidebar and the session page through
  the panel registry (`session.row@1`, which `../panels` may cover).
- **The window check** reads node names and values and canvas items' values, so a status mark drawn only as
  pixels, with no accessible text for its glyph, fails it.
- **macOS only**, as the replica is; elsewhere INCONCLUSIVE.

## Files

- `surfaces.rs`: the 22 cases and their harness.
- `fixtures/`: the eleven row records, the notifier's base record and the live templates.
- `BASE-FAILURE.txt`: the run at the base, and the stand-in's matrix of wrong programs.
- `README.md`: this file.
