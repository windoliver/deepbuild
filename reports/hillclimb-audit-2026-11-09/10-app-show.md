# 10 — the app and the composition hosts (deep-app, deep-replica, deep-show)

Read-only audit at main 6a6d6b4f. Nothing was built or run; every claim below comes from reading the code and its callers. Paths are relative to the repo root. "S" is the number of sessions in the record, "A" the asks the folded table still holds (open or defaulted), "N" the events in the record (the #34 bench seeds about 3,000 a day, so about 90,000 for 30 days, 90 pages of 1,000).

Ranked by gain over risk. Finding 3 is the largest cost in the area but is not an apply-now edit: it needs an owner decision.

---

## 1. The record reader deep-clones every hub reply, twice per page — CONFIRMED

**Where**
- `crates/deep-app/src/hub.rs:229-232` (`HubClient::call` returns `line.get("result").cloned()`).
- `crates/deep-app/src/record.rs:139` (`fold_before`), `:359` (`connect`, the inbox), `:391` (`handle`, one stream event), `:410` (`refetch`), `:433` (`history`).

**What**
`call` owns `line` and still clones the whole `result` out of it, then drops `line`. Each paging caller then does `page["events"].as_array().cloned()`, a second deep clone of up to 1,000 events, and drops `page`. `fold_before` only borrows the events after cloning them (`for event in &events { self.table.apply(event) }`). So one parsed page is allocated three times where once is enough.

Who runs it and how often:
- `fold_before` runs on the window's reader at every connect (`RecordReader::unopened_folded`, `main.rs:478`), over the whole record from position 0: about 90 pages at 30 days. It runs inside `record::read` on the tick's foreground task (`main.rs:510`), so on the UI thread. This is the "inbox loaded in under 1 s with 30 days of history" path.
- `history()` runs on the UI thread on every question-card present, press and confirm (`card.rs:106`, `:224`, `:255`): the whole record again, each time.
- `handle` clones each stream event once before `View::apply` takes it by value.

**Change**
`hub.rs`, in `call`:
```rust
        loop {
            let mut line = self.read()?;
            if line.get("id").and_then(Value::as_str) != Some(id.as_str()) {
                self.pending.push_back(line);
                continue;
            }
            if let Some(error) = line.get("error") {
                return Err(HubError::Refused(error.clone()));
            }
            return match line.get_mut("result") {
                Some(result) => Ok(result.take()),
                None => Err(HubError::Protocol(line.to_string())),
            };
        }
```
`record.rs`, one private helper and five sites:
```rust
/// Takes the array at `key` out of a reply; empty when the reply has none.
fn take_array(reply: &mut Value, key: &str) -> Vec<Value> {
    match reply.get_mut(key) {
        Some(Value::Array(items)) => std::mem::take(items),
        _ => Vec::new(),
    }
}
```
- `fold_before`: borrow, no copy at all:
  ```rust
  let page = client.call("events.read", json!({ "after": after, "limit": PAGE }))?;
  let events: &[Value] = page["events"].as_array().map_or(&[], Vec::as_slice);
  for event in events { /* unchanged body */ }
  if events.len() < PAGE { break; }
  ```
- `connect`: `let mut inbox = client.call("inbox.read", json!({}))?;` then read `log_pos` first and use `inbox: take_array(&mut inbox, "asks")`.
- `refetch`: `let mut page = ...;` keep the `page["start"]` test as is, then `let events = take_array(&mut page, "events");` (`page["log_pos"]` is still read after the loop and is untouched).
- `history`: `let mut page = ...; let read = take_array(&mut page, "events");`.
- `handle`: take `mut line: Value`, `let Some(event) = line.get_mut("event") else { return Ok(()) };`, keep the three `log_pos` tests, end with `self.view.apply(event.take());`.

**Why it is safe**
Every value taken is owned by a local that is dropped right after; nothing reads the emptied slot (`page["start"]` and `page["log_pos"]` are other keys). `Value::take` and `mem::take` do not remove map keys, so `preserve_order` key order is irrelevant. Error precedence in `call` is unchanged (an `error` wins over a `result`, a missing `result` is still `Protocol(line.to_string())`, printed before anything is taken). `install_local`/`feed` (the replica's doors) keep their clones: they have two owners.

**Gain**
Two of three allocations of every event on connect and on each card press: about 2 x N deep clones (180,000 event clones, each tens of small allocations, at 30 days) per connect and per `history()`; one clone per live stream event. Unmeasured in time; it is all UI-thread time.

**Proof plan**
Pinned by `crates/deep-app/tests/hub_client.rs`, `tests/acceptance/34/app/record_reader.rs` (the reader's reads, gaps, refetch and `fell_behind`), `tests/acceptance/1141/app/{folded,surface,memory}.rs`, and `record.rs`'s `the_inbox_closes_an_ask_as_the_core_does`. Measure with the counting allocator `lists_1477.rs` already has: allocations during `RecordReader::open_folded` against a hub seeded with a fixed number of events, before and after.

**Risk** low. About 25 changed lines.

Not proposed here, noted: the fold itself still runs on the UI thread at connect (about 90 synchronous round trips before the window can draw again), and a card press still reads the whole record (`history()`), both by #1141's design.

---

## 2. The Agents page polls `agents.read` every 2 s for the app's whole life, shown or not — CONFIRMED (cost), fix has one stated visible change

**Where**
- `crates/deep-app/src/views.rs:316-324` (the poll starts in `Shipped::new` for `Kind::Agents`), `:368-374` (`read_agents`, a synchronous `record::call` on the UI thread), `:532-541` (`impl Panel for Shipped`).
- `crates/deep-app/src/views.rs:2043` (`Layout::app` always lists `AGENTS` in the center) and gpui-kit's `RegistryPanelBuilder::build` (`crates/base/src/dock/dock_area.rs:1750-1768` at the pinned rev), which builds every panel of a layout at load.
- Hub side: `packages/hub/src/agents.ts:873-890` (`read()`), `:428-439` (`loginPath`, `which`, `installed`).

**What**
The dock builds the Agents panel at window open, so its poll runs from launch to quit even though the tab is hidden. Each poll is a blocking hub call on the UI thread, and on the hub's event loop it does synchronous disk work: `config.json` read and parsed once per agent (`which` -> `loginPath`), `existsSync` across PATH for each agent binary, each agent's MCP config file read and parsed whole (`~/.claude.json` for Claude Code), `servers.json`, the managed map, `skills.json`, every skill file read and hashed twice (`differs(k)` is called twice per skill), and every sync JSON. That is 0.5 calls/s for as long as the app is open, against "hub 0.5% of a core idle" and "app 1% of a core idle", and a UI-thread stall of the hub's handling time every 2 s.

**Change**
Start and stop the poll from the dock's own edge callback instead of the constructor. In `Shipped::new` drop the `let poll = ...` block and set `_agents_poll: None`. In `impl Panel for Shipped` add:
```rust
    /// The Agents page reads the hub's model while it is the displayed tab.
    fn set_active(&mut self, active: bool, _: &mut Window, cx: &mut Context<Self>) {
        if self.kind != Kind::Agents {
            return;
        }
        self._agents_poll = active.then(|| {
            cx.spawn(async move |this, cx| loop {
                if this.update(cx, |this, cx| this.read_agents(cx)).is_err() {
                    return;
                }
                cx.background_executor().timer(AGENTS_TICK).await;
            })
        });
    }
```

**Why it is safe**
`Panel::set_active` is the kit's contract for "becomes, or stops being, the displayed tab": one call per edge, on the next tick, and the initially displayed tab does get `true` (`crates/base/src/dock/active.rs`, `reconcile`). `Kind::Agents` is only ever created by the dock's registry builder (`register_views`); the two non-dock creators, `views::shipped(..)` in deep-replica and `spike.rs`, make `Sidebar` and `Welcome`, and `pop_out` is only called with `NeedsYou`. A replica's reader is `Source::Local`, where `record::call` already returns `None`, so replicas see no change. `tests/acceptance/148/*` call the hub's methods as the cli role and do not depend on the app's poll.

**What observably changes**
The model is no longer refreshed while the tab is hidden. On switching to Agents, the first frame draws the model it last held (empty the first time) and the read lands one tick later. Today the first frame after a switch is at most 2 s stale instead.

**Gain**
All `agents.read` traffic while the tab is hidden: the hub's per-call disk work and JSON parse, and one UI-thread stall per 2 s. Unmeasured in time.

**Proof plan**
Count `agents.read` lines on the hub's socket for 10 s with the app on Needs you: 5 before, 0 after; then switch to Agents and see 1 within a tick and 1 per 2 s. Existing pins: `views.rs` unit tests, the replica's Agents check (`crates/deep-replica/src/drive/check.rs:242`).

**Risk** low to medium (one frame of the old model on a tab switch). About 15 lines.

Cross-area note for the hub's auditor: `agents.ts` `read()` calls `this.differs(k)` twice per skill (`:888`) and `loginPath()` re-reads `config.json` once per agent.

---

## 3. The hub's canvas core replays its whole call log on every call, and the app's Terminal tab feeds that log 4 times a second forever — cost CONFIRMED, fix needs an owner decision

**Where**
- `crates/deep-show/src/main.rs:1509-1611` (`CanvasSide`): `self.calls.push(..)` at `:1568`; popped only for bad input (`:1570`) and `deep_kinds` (`:1593-1595`); `scenario()` (`:1521-1549`) clones the world and every logged call and parses them into a fresh `Scenario`; `:1588-1590` builds `Hub::new` and `run_calls()`, then keeps only the last reply.
- `crates/deep-show/src/shared.rs:1594-1623` (`run_calls` plays every call through `Hub::call`).
- `packages/hub/src/canvas.ts:129-178`: one `deep-show canvas` child per hub, for the hub's life; `core.ts:6790-6793`: the app's `canvas.user` goes through the same `Canvas.call`.
- `crates/deep-app/src/views.rs:399-437`: one click on a session's Terminal starts a 250 ms poll of `canvas.user {call: "cells"}`; `self.terminal` is never cleared, so the poll runs until the app quits, whether or not the page is shown or a terminal is hosted. `read_terminal` is a synchronous hub call on the UI thread.
- `crates/deep-show/src/hub.rs:1727-1789` (`presented_revision`) with `canvas.ts:187-195` and `core.ts:6603` (`shownDocs` only grows, every document is on panel `main`): each presented revision prepares, rasters at 800 x 600 on the CPU, PNG-encodes and hashes the layer of every document ever shown, each with a fresh `Renderer::new()`.
- `packages/hub/src/core.ts:6609-6621` (`canvasWorld()`): two full-table queries and a `JSON.parse` per `reading.recorded` event before every canvas call.

**What**
By its doc comment the canvas side plays "each call after every call before it". So call n costs the sum of all calls before it: every earlier `deep_show` is checked, probed, rastered and PNG-encoded again (the evidence write is skipped, the SHA-256 is not), a new `Hub`, scheduler, shaper (every bundled face registered) are built, and the log is cloned and re-parsed. Total work is quadratic in the number of canvas calls in a hub's life, and the log (every document ever sent) is never trimmed. The Terminal tab's poll adds 14,400 log entries an hour after one click; each later poll, each `deep_show` and each render-back replays all of them, while the app's UI thread waits in `record::call`. `deep_show`'s own promise is an answer within 2 s (`PRESENT_MS`).

**Change**
No behaviour-preserving edit removes this; the stand-in's virtual clock is the call index (`(i + 1) * CANVAS_SPACING`, `main.rs:1542`), so dropping any logged call moves every later call's time (quota windows, `current_at`, terminal feeds). I checked and rejected "pop `cells` like `deep_kinds`" for that reason: a scripted terminal's feed arrives by virtual time, which the polls advance.
Options for the owner, smallest first:
1. deep-app only: run the Terminal poll from `Panel::set_active` for `Kind::Session` (as in finding 2), so it stops while the page is not the displayed tab. Visible change: the stand-in's clock no longer advances from polls while the page is hidden. Halves nothing asymptotically, but removes the "one click, forever" source.
2. deep-show: keep the `Hub` alive across lines and play only the new call. It needs the `Scenario` owned beside the `Hub` (today `Hub<'a>` borrows it) and a world update applied in place. Replies must stay those of the replay; every canvas acceptance suite pins them.
3. Within the replay as it is, two small confirmed savings: hoist `Renderer::new()` out of the per-layer closure in `presented_revision` (`hub.rs:1758`; one shaper per presented revision instead of one per document on the panel), and keep `input` in `CanvasSide` with calls stamped once at push instead of cloning and re-stamping the whole log per line.

**Why it matters / gain**
With k pixel `deep_show` calls logged, the next canvas call redoes k checks, k probe frames, k CPU rasters and k PNG encodes, plus one raster and encode per document ever shown. Unmeasured in time; the growth is linear per call and quadratic in total, and memory grows with every call.

**Proof plan**
A count, no wall time: add the calls a `canvas` line plays to its reply in a test build, or count `Hub::call` invocations per line: today line n plays n; after option 2 it plays 1. For option 1: count `canvas.user` requests at the hub over 10 s with the Session page hidden after a Terminal click: 40 before, 0 after. Pins: `tests/acceptance/806`, `393`, `402`, `1172` (terminal tab), `1454`.

**Risk** option 1 low to medium (about 15 lines); option 2 high; option 3 low (about 10 lines, see finding 5 for the hoist).

---

## 4. `deep_show`'s check path clones the document three times it does not need — CONFIRMED

**Where**
- `crates/deep-show/src/hub.rs:1891`, `:1972`, `:1981` (`current_doc`).
- `crates/deep-show/src/verdict.rs:65-76` (`without`), callers `hub.rs:2009-2012` and `query.rs:187-190`.
- `crates/deep-show/src/hub.rs:1311-1337`, `:1906-1911` (`look_of` then `look_def_of` again).

**What**
(a) `show()` deep-clones the current revision's whole document into `current_doc` on every call, only to pass `current_doc.as_ref()` to `whole_diff`, a free function that returns an owned `Diff` (`deep-canvas/src/show.rs:192`).
(b) `verdict::without(&Value, ..)` clones its argument; both callers pass a temporary they just built (`&packs::drawn(doc, ..)`), so the drawn form is built, cloned, and the first copy dropped. With nothing skipped it is literally `return doc.clone()`.
(c) When a document names a look, `look_of` reads and parses the look file from the evidence store, then `self.look_def = self.look_def_of(doc)` reads and parses the same file again.
All three run once per `deep_show` (and (b) once per `deep_query` revision), and under finding 3 once per replayed call.

**Change**
(a) Delete line 1891 and pass the borrow at both call sites:
```rust
whole_diff(self.current(&show.doc).map(|c| &c.doc), &doc, &writer.layer_id(), &removes, scope)
```
(same for the `PresentsUnnamedRemoval` call with `&[]`).
(b)
```rust
pub fn without(mut doc: Value, skipped: &[String]) -> Value {
    if let Some(Value::Object(items)) = doc.get_mut("items") {
        for id in skipped {
            items.remove(id);
        }
    }
    doc
}
```
and drop the `&` at the two callers.
(c) Make `look_of` return `Option<(Look, Value)>` (the resolved look and the `def` it resolved from) and set `self.look = look; self.look_def = Some(def);`. `look_of` has this one caller.

**Why it is safe**
(a) Nothing between line 1887 and the diff touches `self.revisions` (rows are pushed at `:2080-2096`, after), so `self.current(&show.doc)` at the diff is the same row; the borrow ends with the call because `Diff` and the issues are owned. The statements between only take `&self` or disjoint fields (`self.look`, `self.sandbox`).
(b) Same `items.remove` on the same map, applied to the owned value instead of a clone of it; with `skipped` empty the loop does nothing.
(c) `look_of` succeeding implies `look_def_of` returned `Some(def)`; the second read returns the same bytes unless the content-addressed file changed between two reads.

**Gain**
Two deep clones of the document and, with a look, one file read and JSON parse, per `deep_show`. Unmeasured in time.

**Proof plan**
Pins: `crates/deep-show/tests/shared.rs`, `tests/render_back_pipeline.rs`, the `main.rs` scenario tests, `tests/acceptance/393` and `306` (expansions and skipped kinds), `464` (print look). Count with the crate's own `count_allocations` around one `show` of a fixed document, before and after.

**Risk** low. About 20 lines.

---

## 5. `presented_revision` builds a new renderer (and shaper) per layer — CONFIRMED

**Where** `crates/deep-show/src/hub.rs:1756-1771`; `Renderer::new` at `snapshot.rs:361-366`; `Shaper::new` at `crates/deep-text/src/shape.rs:144-159`.

**What** The per-layer closure calls `Renderer::new()`, which builds a font collection and registers every bundled face, once per document on the panel per presented revision. In the hub's world every shown document is on panel `main`, so this is once per document ever shown, per `deep_show`.

**Change** Move `let mut renderer = Renderer::new();` above `let layers: Vec<Value> = self.bands()...` and let the closure borrow it mutably.

**Why it is safe** The function is `&self`, so it cannot use `self.renderer`; a local shared across the layers of one call is the same sharing the hub's own renderer already has across all its snapshots (`Hub.renderer` is reused for every raster of a run, and goldens hash its output). The layers are rastered in the same order.

**Gain** (documents on the panel - 1) shaper constructions per presented revision. Unmeasured; small beside the raster and PNG encode, which stay.

**Proof plan** `tests/acceptance/806` (the presented layers and their picture hashes), `995` (the app's pictures). Count `Shaper::new` calls per call with a counter in a test build.

**Risk** low. 3 lines.

---

## 6. `to_rgba8()` on an owned decode copies the whole image — CONFIRMED

**Where** `crates/deep-app/src/show.rs:260-262`; `crates/deep-show/src/snapshot.rs:332-335`; `crates/deep-show/src/kit/compare.rs:160`; `crates/deep-replica/src/drive/check.rs:218`.

**What** Each site decodes into an owned `DynamicImage` and calls `.to_rgba8()`, which always allocates a new buffer and converts pixel by pixel. `into_rgba8()` returns the buffer as it is when the image is already RGBA8, and converts otherwise. The app's pictures are the canvas core's own layer PNGs (`snapshot::png` writes 8-bit RGBA only), so in `show.rs` every picture takes the copy, on the UI thread (`present` runs inside `cx.update`): 1.9 MB per 800 x 600 layer.

**Change** `.to_rgba8()` -> `.into_rgba8()` at the four sites (in `check.rs`: `.map(|i| i.into_rgba8())`).

**Why it is safe** Same pixels for every input format; only the already-RGBA8 case skips a copy. All four values are temporaries consumed by the call.

**Gain** One full-frame allocation and copy per decoded picture. Unmeasured in time.

**Proof plan** `tests/acceptance/995/app/panel.rs`, `tests/acceptance/806`, deep-show's `snapshot.rs` image tests, the kit's compare tests. Count allocations of `picture()` on one PNG.

**Risk** low. 4 lines.

---

## 7. Every shipped view builds the open-asks list, and most never read it — CONFIRMED

**Where** `crates/deep-app/src/views.rs:697-712` (`read`), used at `:961` and `:1159-1163` (Home), `:1181` (Needs you), `:733-737` and `:1223-1227` (Session). `states.rs:469`, `:484`.

**What**
(a) `read(view, kind)` walks the whole inbox and allocates four `String`s plus `question::visible` per open ask for every kind. The Sidebar, the Line, Welcome, Agents and Rules never read `record.open`. The Sidebar and the Line re-render on every record change, and the Sidebar on every hover edge over a row (`.hover(..)` notifies the containing view: `vendor/gpui-pre/src/elements/div.rs:2696-2704`, `:2860-2867`).
(b) `Table::state` and `Table::row` ask `open_asks(Some(session))`, which collects a `Vec`, only to test `is_empty()`. The Sidebar calls both for every session on every render.

**Change**
(a)
```rust
    let open: Vec<(String, String, String, String)> = match kind {
        Kind::Home | Kind::NeedsYou | Kind::Session => view.inbox.iter() /* unchanged chain */ .collect(),
        Kind::Sidebar | Kind::Line | Kind::Welcome | Kind::Agents | Kind::Rules => Vec::new(),
    };
```
(b) In `states.rs`:
```rust
    /// Whether an ask the session raised is still open.
    fn asks_you(&self, session: &str) -> bool {
        self.asks.iter().any(|ask| ask["session"] == session && self.is_open(&handle(ask)))
    }
```
and use `self.asks_you(session)` at `:469` and `!self.asks_you(session)` in the guard at `:484`.

**Why it is safe**
(a) `Record` and `read` are private to `views.rs`; the only readers of `.open` are the three kinds kept, and the test `a_needs_you_row_shows_a_direction_mark_as_the_card_does` reads `Kind::NeedsYou`. `views::sidebar()` reads `.sessions`.
(b) Same two predicates as `open_asks`, `any` in place of collect-then-`is_empty`.

**Gain** Per Sidebar or Line render: one inbox walk and 5 x (open asks) allocations less; per session row, two `Vec`s less and an early exit. Small per render; the Sidebar renders on every hover edge and every record change.

**Proof plan** `states.rs` tests (`a_session_whose_asks_all_closed_no_longer_needs_you`, the 2,000-seed fold equivalence), `tests/acceptance/1141/app/surface.rs`, `992`, the replica's sidebar snapshots. Count allocations of one `Shipped{Sidebar}` render in `screens.rs`'s harness.

**Risk** low. About 12 lines.

Observation, not a finding: the Sidebar draws every session in the record with plain `div`s, is not scrollable and is not virtualized (`uniform_list` appears only in `spike.rs`; #1477's `TableView` has no shipped caller). Its render is O(S) elements and O(S x A) lookups per hover edge. Virtualizing changes the accessibility tree the replicas read, so it is an issue-level change.

---

## 8. A presented canvas revision repaints every view of every window — PLAUSIBLE

**Where** `crates/deep-app/src/show.rs:243-248` (`cx.refresh_windows()` after `panel.present`), `views.rs:1277-1282` (the Session page decides whether to mount the panel).

**What** `follow` takes presentations every 100 ms; each non-empty take refreshes all windows, which re-renders the shell, the dock, the Sidebar (its full `read`), the Line and the palette, when only the canvas panel changed. That is the "stray notify near the window root" the Chrome frames row names, up to 10 times a second while an agent draws.

**Change**
`show.rs`:
```rust
                    panel.update(cx, |panel, cx| {
                        presented.into_iter().for_each(|p| panel.present(p));
                        cx.notify();
                    });
```
(no `refresh_windows`), and in `Shipped::new`, for the Session page to mount a panel that just got its first revision:
```rust
        if kind == Kind::Session {
            if let Some(panel) = CANVAS.with(|canvas| canvas.borrow().clone()) {
                cx.observe(&panel, |_, _, cx| cx.notify()).detach();
            }
        }
```

**Why it should be safe** `set_canvas` runs before `Shell::new` builds the Session panel (`main.rs:283-287`), and `follow`/`set_canvas` have that one caller; the replica drives its own `CanvasPanel` (`deep-replica/src/canvas.rs`) and is untouched. Nothing else draws from `CanvasPanel`.

**What I could not check** That the Session page and the panel both redraw in the real window on a first and on a later revision: it needs the app run against a hub (`tests/acceptance/806`, `1454`).

**Gain** Per presented revision: two views rendered instead of all. Unmeasured.

**Risk** medium. About 10 lines.

---

## 9. The canvas panel decodes its pictures on the UI thread — PLAUSIBLE

**Where** `crates/deep-app/src/show.rs:175-188` (`present` -> `picture`), `:243-246` (called inside `cx.update`), `:258-267`.

**What** `follow` already takes the presentations on the background executor, but each new layer picture is then read from disk, PNG-decoded and channel-swapped inside `cx.update`, on the UI thread: an 800 x 600 RGBA PNG per layer, per document on the panel, per presented revision, against "shipped panels update within 4 ms on the UI thread".

**Change** Decode in the background step that already holds the reply: after `Presentations::take`, read the held hashes once (`cx.update` -> a `Vec<String>` of `panel.pictures` shas), decode the missing ones in `background_spawn`, and hand them to a `present_with(p, decoded)` that only inserts. `present(p)` stays for the replica and `tests/acceptance/995`.

**What I could not check** The decode time on this machine (no runs allowed), and that `RenderImage` built off-thread is accepted by `paint_image` (it is `Arc<RenderImage>` and `Send`, as the type is used across `background_spawn` elsewhere in gpui, but I did not find a caller in this repo that does it).

**Gain** The decode leaves the UI thread. Unmeasured.

**Risk** medium. About 30 lines.

---

## 10. The shipped app records every canvas item it paints for a replica that is not there — CONFIRMED (dead work in the shipped build)

**Where** `crates/deep-app/src/canvas.rs:24-64` (`DRAWN`, `PLACED`, `record`), callers `canvas.rs:73`, `:151`, `text.rs:48-63`, `cells.rs` (the paint closure's `record(&id, json!({... "text": rows cloned ...}), bounds)`).

**What** On every paint, each canvas label, the session line and the terminal grid build a JSON value (the grid clones every row's text) and insert it into two thread-local maps. Only `items()`, `placed()` and `clear_items()` read or clear them, and every caller of those is in deep-replica or a deep-app test target (`crates/deep-replica/src/{replica,snapshot,live,main,plain_words}.rs`, `drive/{locate,frames,mod}.rs`, `headless.rs`, `crates/deep-app/spike_402.rs`, `tests/acceptance/326/panels/*`, `tests/acceptance/1425/app/panels.rs`, all built with `deep-app/fixtures`). In the shipped app nothing clears the maps, so they are long-lived maps keyed by ids a script chooses (`CanvasScene.set(id, ..)`), with no declared bound.

**Change** Put the recording behind the existing `fixtures` feature (the replica's door, #1457) and make the value lazy:
```rust
#[cfg(feature = "fixtures")]
pub(crate) fn record(id: &str, value: impl FnOnce() -> Value, bounds: Bounds<Pixels>) { /* today's body with value() */ }
#[cfg(not(feature = "fixtures"))]
pub(crate) fn record(_: &str, _: impl FnOnce() -> Value, _: Bounds<Pixels>) {}
```
with `clear_items`, `items`, `placed` and the two thread-locals under the same `cfg`, and the four callers passing `|| json!(..)`.

**Why it is safe** No shipped-build code reads the maps (repo-wide grep above). deep-replica depends on `deep-app` with `fixtures` (`crates/deep-replica/Cargo.toml:13`); deep-app's own test targets get it through the dev-dependency on itself. `deep-panel-host` and `deep-gpu-layer` do not call `canvas::items`/`placed`.

**What changes** Nothing a person or a test sees; no new feature (it reuses `fixtures`).

**Gain** Per paint: no JSON build, no row-text clones, no map inserts; two unbounded maps leave the shipped build. Small.

**Proof plan** The replica suites above still read items (they build with `fixtures`); a `cargo build -p deep-app` without features proves the shipped build compiles without the maps.

**Risk** low to medium (a `cfg` split). About 25 lines.

---

## 11. The record tick blocks the UI thread 5 ms every 250 ms when nothing arrives — PLAUSIBLE

**Where** `crates/deep-app/src/main.rs:510` (`record::read(Duration::from_millis(5))` on the foreground task), `record.rs:300-332` (`poll`), `hub.rs:147-170` (`read_within` sets a read timeout and blocks in `read_line`).

**What** An idle tick waits the full 5 ms in a blocking socket read on the UI thread, 4 times a second: 2% of the UI thread's time unavailable, and any frame that lands in the window waits up to 5 ms, against the 4 ms panel budget. With a backlog the loop does not stop at the deadline either: `read_within` always waits at least 1 ms, so `poll` drains until a read times out.

**Change** Smallest: pass `Duration::from_millis(1)` (the floor `read_within` already applies). Events that arrive in the next 4 ms are then applied a tick later.

**What I could not check** Whether any suite times an event's arrival to the window within less than one tick.

**Gain** 4 ms of UI-thread stall less per tick. No CPU change.

**Risk** low to medium. 1 line.

---

## Dispositions

| Crate | Disposition |
| --- | --- |
| `crates/deep-app` | Findings 1, 2, 6, 7, 8, 9, 10, 11; the app half of 3. Question card, arming, trusted input, capture gates: read, no change proposed. `table/` (#1477) is careful and has no shipped caller yet: keep. `rules.rs` is read and parsed inside `Shipped::render` for `Kind::Rules`, but the shipped layout never mounts that page (replica only): keep. `card::tick` notifies the shown card every 250 ms unconditionally: trusted path, left alone. Idle wake sources, for the record: record tick 4/s, `canvas.drawn` 10/s by design ("as the hub expects of an open app"), `views.shown` 0.2/s, `agents.read` 0.5/s (finding 2). |
| `crates/deep-show` | Findings 3, 4, 5, 6. Also seen, too small to list: `watch.rs:277` clones the map out of an owned `drawable(..)` value once per shown revision; `shared.rs:1374` passes a fresh `packs::drawn` to `drawable(&Value)`, which clones it again (changing `drawable` touches 7 callers). `decode_all` re-reads, re-hashes and re-decodes every image asset on each `prepare`/`prepare_drawing` (twice in `eval` with `film` and `pixels`); a decoded-image cache would skip the per-read hash check and needs a declared bound, so it is not proposed. Kit, planted twins and test modules: untouched. No crate split proposed. |
| `crates/deep-replica` | Keep. It drives the app on GPUI's virtual clock (`advance_clock` + `run_until_parked`) everywhere but `click_and_watch`, which paces real frames on purpose (#1556), and `canvas.rs`'s 100 ms `recv_timeout`, which mirrors the app's follow interval. No fixed sleep stands where an event exists. One line under finding 6 (`drive/check.rs:218`). |
