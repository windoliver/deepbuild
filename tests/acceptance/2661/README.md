# Acceptance tests for #2661: one copy of a hub reply, no poll of a page that isn't shown, no UI-thread wait for an idle read, no list to test for an ask, no canvas record for a replica that isn't there

Written first, blind, from issue #2661 (its findings, Scope, seven criteria and Proof), the design sections it links
(Numbers version 0 has to hold; How we know version 0 works) and the base commit `b6b99ad8c` (main), by a job that
never saw an implementation. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job.

What was read at the base: `crates/deep-app/src` (`hub.rs`, `record.rs`, `views.rs`: the Agents page, `open_terminal`,
the Sidebar's reading and the dock; `states.rs`: `Table::open_asks`, `state`, `row`; `list.rs`; `canvas.rs`; `open.rs`;
`setup.rs`; `main.rs`'s record tick), `crates/deep-replica/src/live.rs` (`--watch` and its tick),
`crates/deep-app/Cargo.toml`, `benchmarks/budgets.json`, `benchmarks/app-select-700.mjs`, `benchmarks/replica.mjs`,
`scripts/benchmark.mjs`, `scripts/perf.mjs`, `scripts/budget-window.mjs`, `scripts/app-bundle`, and the suites
`tests/acceptance/1546/` (criterion 4 and its live test), `tests/acceptance/326/panels/`, `tests/acceptance/1141/`
(whose 30-session record AC1 reuses by import) and `tests/acceptance/1738/` (the shell in gpui-kit's test window).

## Run them

```sh
cargo test --locked -p deep-app --test acceptance_2661 --no-fail-fast        # AC1, AC2, AC3, AC5
node --test tests/acceptance/2661/ac6-canvas-record.test.mjs                  # AC6 (builds the shipping app and #326's suites)
DEEP_LIVE_2661=1 node --test tests/acceptance/2661/ac4-tick.live.test.mjs     # AC4, by hand: a real window on this Mac's display
DEEP_TIMED_2661=1 node --test tests/acceptance/2661/ac7-budgets.test.mjs      # AC7, by hand or in a budget window: hours
```

`cargo` must be on `PATH`. macOS only for AC4, AC6 and AC7 (they fail INCONCLUSIVE elsewhere); the Rust binary runs
anywhere the app's library builds. A build that fails, a window that never says it is ready or a tool that can't read
fails `BLOCKED:`; nothing missing passes. Temp folders are `/tmp/da2661-*`; every process is stopped by its PID.

## The tests

| Criterion | File | Test | What fails it |
|---|---|---|---|
| AC1 the fold of a 90,600-event record at connect allocates at most 1.5 times the bytes of its parsed pages | `app/ac1_fold.rs` | `ac1_the_fold_of_a_90600_event_record_at_connect_allocates_at_most_1_5_times_its_parsed_pages` | A fold that copies a reply's result or a page's events (the base: about three times), or one that skips the fold (the sessions it shows) |
| AC2 a hidden Agents page asks the hub nothing; shown again, one read within 100 ms, drawn | `app/ac2_agents.rs` | `ac2_a_hidden_agents_page_asks_the_hub_nothing_and_shown_again_reads_once_within_100_ms` | The base's poll for the app's life (30 reads in 60 s hidden); a page that waits for its next tick to read once shown, reads more than once, or draws an older reading |
| AC3 a Terminal tab left for another page asks the hub nothing for 60 s | `app/ac3_terminal.rs` | `ac3_a_terminal_tab_left_for_another_page_asks_the_hub_nothing_for_60_s` | The base's 250 ms poll for the view's life (240 calls) |
| AC4 an idle tick blocks the UI thread under 1 ms; an event is applied within a tick plus a frame; a planted tick that stops reading fails, naming the event | `ac4-tick.live.test.mjs` | two tests: the idle tick and the events; the planted tick | The base's 5 ms wait a tick; a tick slower than 250 ms plus a frame; the plant `tick-stops-reading` read as a pass |
| AC5 a render of the Sidebar with 700 sessions allocates no list of asks; every row's word is the merge base's | `app/ac5_sidebar.rs` | `ac5_a_render_of_the_sidebar_with_700_sessions_allocates_no_list_of_asks` | The base's `open_asks(Some(session))` per session; a fix that changes a row's word |
| AC6 the shipping app holds neither canvas map; the replica's build reads every item #326's suites read | `ac6-canvas-record.test.mjs` | one test | The base's maps in the shipping build; a replica build that stops recording what #326's suites read |
| AC7 `app-select-700` and `replica-memory` retire no more instructions and peak no higher than on the merge base | `ac7-budgets.test.mjs` | one test | A change whose instructions retired rise over 2% (or can't be told from it), or whose peak passes the merge base's by over 5% |

### Counting (`app/alloc.rs`)

The Rust binary's global allocator counts only the thread that turned counting on, so the stand-in hub's threads and
other tests never add to a reading. Bytes are each allocation's size and each reallocation's growth. For AC5, while a
set of ask addresses is armed, each block the counted thread frees is read first: a block whose first word is the
address of one of the record's open asks is a list of asks (`Vec<&Value>`), one session's unless its second word is
another session's ask. Blocks are zeroed as the counted thread gets them, so every word read was written while counting.

### The stand-in hub (`app/hub.rs`)

#16's line protocol on a Unix socket, as #34's and #1141's scripted hubs speak it: the hello the app's check accepts
(the contract and every method in `hub::NEEDS`), the control token, and a reply per call from the test. It logs every
call and the exact line it wrote. AC2 and AC3 also name it as the hub's address in the test's home (`hub.address` in
`~/.deepbuild/config.json`, under `/tmp/da2661-home-<pid>`), so a call the app makes on a connection of its own
(`hub::call_app`) reaches it as the window reader's calls do.

### The window (`app/window.rs`)

The app's window as `main.rs` builds it, in gpui-kit's test window: `views::Shell` on `Layout::app(false)` (the list, and
Home, a session's page and Agents, each built when the window opens), with the window's reader
(`RecordReader::open_folded`) on the stand-in. Pages are shown by address, `open::arrive("page/agents")`, as a link,
`deep open` or a click in the list shows them. Time passes on GPUI's virtual clock (`advance_clock`, which fires each
timer due), a frame drawn after each step: 250 ms steps while a page is hidden, 60 Hz frames for the 100 ms after it
shows again.

### The record each test reads

- AC1: #1141's heavy record of 30 sessions (`tests/acceptance/1141/app/bulk.rs`, imported), its first 90,540 events
  and its 60-event tail, which leaves every session in a known state. The inbox read gives log_pos 90,600, no asks and
  no rows, so the record before it is folded; the reader reads it in 91 pages. The count runs from the reader's open
  until it says it has folded (`record::folded()`) at log_pos 90,600, so a fold moved to the next read is counted too.
  The bytes of the parsed pages: each reply line the stand-in sent for `events.read`, parsed once by `serde_json`.
- AC2: an empty record. The n-th `agents.read` is answered with one MCP server named `stand-in reading n`, so the server
  row the page draws (`("agents-server", 0)`, its accessibility label) names the reading it shows.
- AC3: one session (`session.start`, `task.created`). The stand-in answers `canvas.user`'s `session_page`, `tab` and
  `cells` calls; the Terminal control (`session-terminal`) is clicked as a person clicks it.
- AC5: 700 sessions in five states by `k % 5` (an open ask; a tool call under way; an open ask and a finished tool call;
  a claim judged PASS; a finished tool call). 280 hold one open ask each, raised in the sessions' order. No rows the
  hub built, so the app reads each session's state itself. The Sidebar is the shipped view alone in a 320 x 982 window;
  the counted render is its first: the window opened and its first frame drawn.

### The merge base's words (`app/fixtures/sidebar-700-words.json`)

Every row's `(session, state word)` as `list::read` gives them (the reading the Sidebar draws) for AC5's record at the
views' clock `1,800,000,000,000`, written once from the merge base `b6b99ad8c` by a throwaway test that was then removed.
It is expected output, so the edit guard covers it.

## What the implementer adds outside this folder

- `crates/deep-app/Cargo.toml`: the `[[test]]` entry `acceptance_2661` (this job added it).
- The planted tick, for AC4: `DEEP_HUB_PLANT=tick-stops-reading`, read through `plain::planted` in a build with the
  `env-plants` feature only (#1408), in the tick `deep-live --watch` runs: the tick stops reading the hub. At the base the
  name selects nothing.
- `scripts/lanes.mjs` (a guarded file): `byHand` and `timed` for `tests/acceptance/2661/ac4-tick.live.test.mjs` and
  `tests/acceptance/2661/ac7-budgets.test.mjs`; `alone` for `tests/acceptance/2661/` (the files build binaries, start
  windows and run benchmarks). This job didn't edit it.

## Open points (where the issue leaves a choice open; each is a place to dispute, by blind redraft)

1. **AC4, "read from the tick's own timer".** The base's tick has no timer of its own, and the issue names no place
   its reading is read (a log line, a `deep-live --watch` field, a doctor reading). Rather than guess one, the test
   reads the blocked time from outside: `sample` takes the window's main thread every millisecond for 10 s of a quiet
   hub, and the samples waiting in a socket receive (`__recvfrom`) are its blocked milliseconds over the 40 ticks. Once
   the tick has its own timer and a place to read it, that reading should replace the sample.
2. **AC4's plant is named here.** `tick-stops-reading` is this job's name; the issue names none.
3. **AC5, "no list of asks".** The test fails on any list of one session's asks (the issue's finding: a session's list
   built to test whether it is empty). The views also build lists of every open ask once per reading (`views::read`'s
   deadlines, `list::read`'s asks by handle), which span sessions; the test counts and prints them but doesn't fail on
   them. A literal reading ("no list of asks" at all) would fail on those too.
4. **AC6, "a paint builds no JSON value for them, counted by the test".** A paint can only be counted in a build the
   test can paint in; every deep-app test target carries the dev-dependency's `fixtures` feature, and the issue doesn't
   name the replica's own feature, so a test can't build a paint without the record's feature without guessing that
   name. The test checks what the shipping build itself shows: neither map's thread-local is in the shipping binary
   (`nm`). The count of JSON values a paint builds in the shipping build is not drafted.
5. **AC6, the maps by name.** The shipping binary is searched for `deep_app::canvas::DRAWN` and `PLACED`, the two maps
   `canvas.rs` holds at the base. A change that kept such a map under another name would pass this half.
6. **AC1's 1.5 is drafted.** The issue marks it so. The count is every byte the fold's thread allocates, the lines read
   from the socket included; BASE-FAILURE.txt gives the base's parts.
7. **AC7, "no more" and "no higher".** Instructions are judged by the repo's own rule (`judgeInstructions`: a rise over
   2% FAILs, PASS needs the rise ruled out at p under 0.01); peak by 5%, the smallest margin the design gives a reading.
   A strict "not one more" would fail on run-to-run noise alone. AC7 can't fail on the merge base itself: there both
   sides are the same program.
