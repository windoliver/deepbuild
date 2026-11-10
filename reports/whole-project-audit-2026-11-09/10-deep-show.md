# rust-show: crates/deep-show

Read-only audit of `crates/deep-show` at origin/main 06fd33cd. Nothing was built or run. Paths are relative to
the checkout root. Prior report read and skipped: `hillclimb-audit-2026-11-09/10-app-show.md` (findings 3 to 6
and its Dispositions row).

Counts: 12 findings. By kind: broken 11, inconsistent 1; plus 24 one-line nits (the first two are SURE doc
inconsistencies).
By confidence: SURE 4 (SHOW-1, 4, 5, 8), LIKELY 7 (SHOW-2, 3, 6, 7, 9, 11, 12), QUESTION 1 (SHOW-10).
Nothing unneeded was found: every feature, dependency, subcommand and data file has a user.

Coverage is partial: about a third of the source was read in full or in the parts named; the rest was only
grepped. The table at the end says which. The sub-readers this area needed could not be started.

## Findings (in the order found; ranked list at the end)

### SHOW-1  `serve` opens PTY masters without close-on-exec, so every later child inherits them
- kind: broken
- confidence: SURE (mechanism, from the code alone); impact LIKELY
- where: crates/deep-show/src/serve.rs:207-232 (`openpty`), :252-298 (`spawn_program`), :514-519 (host spawn),
  :1223-1229 (`term-ax` spawn), :1316, :1332, :1402 (`sqlite3` spawns)
- evidence: `libc::openpty(&mut master, &mut slave, null, null, &mut size)` and then
  `OwnedFd::from_raw_fd(master)`. `openpty` returns descriptors without `FD_CLOEXEC`, and nothing in the crate
  sets it (`rg -n "CLOEXEC|F_SETFD" crates/deep-show/src` finds nothing). Rust's `Command` closes no inherited
  descriptor. So the program started on the PTY keeps a copy of its own master, the `deep-show host` child
  started next (:514) gets it too, and every terminal opened later (its program, its host, `term-ax`, each
  `sqlite3`) inherits the masters of all terminals already open.
- failure: `terminal_open` A, then `terminal_open` B. B's program holds A's master descriptor: it can write to
  it (bytes arrive as A's program's input) and read A's output ahead of the hub's reader. The file's own header
  promises "Raw input comes only from you" and "its panel host is a process of its own ... never the hub"; the
  host is meant to see the program's bytes only through its framed stdin. Nothing here needs the copies.
- fix: in `openpty`, after `rc != 0` is ruled out and before the `OwnedFd`s are built:
  ```rust
  // SAFETY: fcntl on the two descriptors openpty just opened.
  unsafe {
      libc::fcntl(master, libc::F_SETFD, libc::FD_CLOEXEC);
      libc::fcntl(slave, libc::F_SETFD, libc::FD_CLOEXEC);
  }
  ```
  The slave may carry it too: `login_tty(fd)` runs in `pre_exec`, before exec, and `dup2`s it onto 0, 1, 2
  (the copies carry no flag) and closes `fd`.
- verify: no existing test sees it. Cheapest new check: in `tests/serve_answers.rs` style, open two terminals,
  have the second run `sh -c 'ls /dev/fd'` (or `lsof -p $$`) and assert it lists only 0, 1, 2.
- risk: none found. The hub side keeps its own descriptors; no test in `tests/acceptance/402`, `990`, `1172`
  relies on a child holding a master.

### SHOW-2  A terminal query waits 600 s when its host process is gone
- kind: broken
- confidence: LIKELY
- where: crates/deep-show/src/serve.rs:834-859 (`ask`), :798-830 (host reader), :731-757 (writer)
- evidence: `ask` queues an `Item::Query` and waits on the replies condvar with
  `wait_timeout(r, Duration::from_secs(600))`. When the host exits, the writer's `write_all` fails and its
  thread returns (:753), and the host reader's `lines()` loop ends (:799) without touching `replies` or waking
  the condvar. Nothing marks the terminal as dead.
- failure: the `deep-show host` child of a terminal dies (a crash, or a test that kills it by the PID
  `terminal_open` returned). Every later `cells`, `rows`, `cell`, `terminal_resize`, `screenshot`, `ax`, and
  every `seam` event to that panel (through `settled_modes` -> `modes` -> `ask`) blocks the single-threaded
  `serve` loop for ten minutes before answering `host_gone`. A reply that arrives after a timeout is also left
  in the queue and is handed to the next query as its answer.
- fix: give `Stream` (or `Replies`) a `gone: AtomicBool`; the host reader sets it and calls `cv.notify_all()`
  after its `for line in ...` loop ends; `ask` returns `{"code":"host_gone"}` when it is set and the queue is
  empty, before queueing and after each wake.
- verify: new case beside `tests/serve_answers.rs`: open a terminal, `kill -9` the host PID, send `cells`,
  expect `host_gone` within a second.
- risk: low. No test pins the 600 s wait (`rg -n "host_gone" tests crates` finds only serve.rs).

### SHOW-3  `terminal_open` on an id that is already open drops the old host and program without ending them
- kind: broken
- confidence: LIKELY
- where: crates/deep-show/src/serve.rs:468-563 (`open`; the insert at :546), :1257-1276 (`close`)
- evidence: `open` never looks the id up; `self.terms.insert(id.clone(), Term { .. })` replaces the entry and
  the old `Term` (its `host: Child` and `program`) is dropped. Dropping a `Child` neither kills nor reaps it.
  `close()` ends only what `self.terms` still holds, "by the PIDs it holds".
- failure: two `terminal_open` lines with the same `terminal`. The first program and host keep running for the
  life of `serve` (their reader and writer threads still hold the master and the host's stdin), are never
  killed by `close()`, and after `serve` exits the program lives on if it ignores SIGHUP. The same leak, for
  the program only, when the host spawn fails at :520-523 after `spawn_program` succeeded at :499.
- fix: at the top of `open`, after the id is read:
  `if self.terms.contains_key(&id) { return json!({"code": "terminal_open"}); }` (or end the old one as
  `close` does). For the host-spawn failure: kill and wait `program` before returning the error.
- verify: a `serve` case that opens the same id twice and checks the first reply's `program.pid` is gone after
  stdin closes.
- risk: QUESTION whether any acceptance suite opens one id twice on purpose; `rg -n "terminal_open"
  tests/acceptance` should be read before choosing refusal over replacement.

### SHOW-4  A stdin line that is not UTF-8 ends `run`/`screen`/`canvas`/`serve` silently with exit 0
- kind: broken
- confidence: SURE
- where: crates/deep-show/src/main.rs:2829-2830; crates/deep-show/src/serve.rs:1411, :1425-1426
- evidence: `for line in stdin.lock().lines() { let Ok(line) = line else { break }; ... }`. `BufRead::lines`
  yields `Err(InvalidData)` for a line that is not UTF-8, so the loop ends, nothing is written for that line or
  any line after it, and `main` returns 0. The module doc (main.rs:1-4) and `tests/acceptance/393/README.md:78-82`
  promise "exactly one JSON object per input line ... A line it can't read as JSON ... answers
  `{"ok":false,"code":"bad_input"}`" and "a run that writes fewer lines than it read ... fails".
- failure: `printf '\xff\n{"evidence":"e","calls":[]}\n' | deep-show run` prints nothing and exits 0; the second,
  valid line is never answered. For `canvas` the hub sees `canvas_core_exited` with exit code 0.
- fix: main.rs:2830 `let Ok(line) = line else { break };` ->
  ```rust
  let line = match line {
      Ok(line) => line,
      // Not UTF-8: the line was consumed; it is one that can't be read.
      Err(e) if e.kind() == io::ErrorKind::InvalidData => {
          let _ = writeln!(out, "{}", bad_input());
          let _ = out.flush();
          if command == "live" { break } else { continue }
      }
      Err(_) => break,
  };
  ```
  (`read_line` consumes through the newline before it reports invalid UTF-8, so the next iteration reads the
  next line.) Same shape at serve.rs:1426 with `bad()`.
- verify: the `printf` above prints two lines, the first `bad_input`.
- risk: none found; no test feeds invalid UTF-8 (`rg -n "\\\\xff|invalid utf" crates/deep-show/tests tests/acceptance/393` is empty).

### SHOW-5  `batch` multiplies a caller's `len` by 8 unchecked: a dev build panics, a release build accepts a lie
- kind: broken
- confidence: SURE
- where: crates/deep-show/src/main.rs:694-698
- evidence:
  ```rust
  let bytes = base64(col.get("data")?.as_str()?)?;
  let len = col.get("len")?.as_u64()? as usize;
  if bytes.len() != len * 8 {
      return None;
  }
  ```
  The workspace sets no `overflow-checks` for release, and the acceptance suites and the hub run dev binaries
  (`Cargo.toml` profile comments; `packages/hub/src/canvas.ts:32` takes the newer of release and debug).
- failure: a scenario line with
  `{"call":"batch","doc":"d","source":"s","columns":{"x":{"dtype":"f64","data":"","len":2305843009213693952}}}`
  (`len` = 2^61). Dev build: "attempt to multiply with overflow", the process dies with no reply line. Release
  build: `len * 8` wraps to 0, equals the empty `data`, and the column is accepted with a declared length it
  does not have.
- fix: `if bytes.len() != len * 8 {` -> `if len.checked_mul(8) != Some(bytes.len()) {`
- verify: `echo '<that line inside a scenario>' | deep-show run` answers `{"ok":false,"code":"bad_input"}`.
- risk: none; every honest `len` takes the same branch as before.

### SHOW-6  `screen` reads a `scale` that is not a number as 1.0 instead of refusing the line
- kind: inconsistent
- confidence: LIKELY
- where: crates/deep-show/src/main.rs:1519-1522 (beside `t` at :1508-1518)
- evidence: `let scale = input.get("scale").and_then(Value::as_f64).unwrap_or(1.0);` then the range check. `t`,
  three lines up, answers `bad_input` for a value it can't read; `scale: "2"` or `scale: null` is drawn at 1.0
  and answered `ok: true`, so a caller that sends the wrong type gets a picture at the wrong size (#1162's
  shots are taken at `scale: 2`, `scripts/checkpoint-1162-shots.mjs:61`).
- fix: `let Some(scale) = optional(input.get("scale"), Value::as_f64).map(|s| s.unwrap_or(1.0)) else { return bad_input(); };`
- verify: a `screen` line with `"scale":"2"` answers `bad_input`.
- risk: low; no test sends a non-number scale (`rg -n "scale" tests/acceptance/1162` shows numbers only).

### SHOW-7  A video frame's picture is kept per asset and never cleared: render-back draws a stale frame, and two items of one asset draw the same frame
- kind: broken
- confidence: LIKELY
- where: crates/deep-show/src/snapshot.rs:233-238 (`Renderer.videos`), :366-384 (`decode_all`);
  crates/deep-show/src/video.rs:159-196 (`videos_at`, `pictures.insert(sha, frame.picture)` at :193); set at
  hub.rs:2081-2082, shared.rs:1376-1377, frames.rs:321-325, time.rs:512-514; read without being set at
  input.rs:370-393 (`Hub::snapshot`, which `render_back` in ask.rs:401-423 and `view` call), frames.rs:219-226
  (`live_drawn`, which `deep_show`'s pixels at hub.rs:2164-2165 and `window::draw` at window.rs:299 call),
  window.rs:339, ask.rs:313-315, live.rs:309
- evidence: `Renderer.videos` is "each video asset's frame at the time being drawn, by asset, set before a
  frame is prepared". Four call sites set it; nothing ever clears it (`rg -n "videos = |videos\.clear" src`
  shows only the four assignments). Every other `self.renderer.prepare*` call draws with whatever the last of
  those four left. And `videos_at` builds `pictures` keyed by the asset's hash, while its `block` is keyed by
  item, so a second item of the same asset overwrites the first's picture.
- failure: (a) `deep_show` a document with an `image@1` video item at `t = 0s` (sets the picture of frame 0),
  then `render_back` of that revision at `t = 2s`: `Hub::snapshot` prepares with frame 0's picture still in
  `videos`, so the snapshot at 2 s shows the frame for 0 s. If no earlier call set it (the `deep export
  --still` path in `packages/hub/src/canvas.ts:86-91`: `time`, then `render_back`), the item is drawn empty.
  (b) two `image@1` items with the same video `asset` and different `frames.in`: `eval` reports two different
  frame numbers under `video`, and both items are drawn with the second item's picture.
- fix: (a) in `Hub::snapshot` (input.rs:375), before `self.renderer.prepare(`:
  ```rust
  // #499: a video image item draws its frame at the time drawn, never one an earlier call left.
  let (_, pictures) = self.videos_at(doc, t, true);
  self.renderer.videos = pictures;
  ```
  and the same two lines (with the session's document) at the top of `live_drawn`; or, smallest, clear
  `self.renderer.videos` at those sites so a stale frame can never be drawn. (b) needs the picture keyed by
  item (`Mark::Image { item, asset, .. }` carries both); not a hand-sized edit.
- verify: `tests/acceptance/499/video` has no render-back case (`rg -ln render_back tests/acceptance/499` is
  empty). New case: show at 0 s, render back at a time in another frame, compare the snapshot hash with a
  fresh run's `eval ... pixels` at that time.
- risk: (a) changes render-back pictures of documents with video items (today empty or stale); no suite pins
  those. The decode worker is started by render-back where it wasn't.

### SHOW-8  The golden store: an unreadable store reads as empty and the next `record` or `decide` overwrites it; the write is unchecked and not atomic
- kind: broken
- confidence: SURE (from the code); no test pins it
- where: crates/deep-show/src/kit/goldens.rs:253-266 (`load`, `save`), :397-427 (`record_reply`), and the
  `decide` path that saves the same way (same file, below :480)
- evidence:
  ```rust
  fn load(path: &Path) -> Value {
      std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok())
          .unwrap_or_else(|| json!({"fixtures": {}, "decisions": []}))
  }
  fn save(path: &Path, store: &Value) {
      ...
      let _ = std::fs::write(path, serde_json::to_vec_pretty(store).unwrap_or_default());
  }
  ```
  `record_reply` does `let mut store = load(&path); ... save(&path, &store); json!({"outcome": "recorded", ...})`.
- failure: (1) `store.json` is cut short (a kill during `fs::write`, which truncates first) or holds one bad
  byte. `load` returns the empty store, `record` adds one digest and `save` writes a store that holds only
  that digest: every other fixture's digests, states and every decision are gone, and the reply is
  `recorded`. (2) the folder is read-only or the disk is full: `save` drops the error and the reply is still
  `{"outcome":"recorded"}`; nothing was recorded. For `judge_golden` an unreadable store reads as "no
  golden" (BLOCKED), which is the safe side; the loss is on the write path.
- fix: `load` returns `Result<Value, ()>`: a missing file is the empty store, a file that is there and does
  not parse is an error. `save` returns `io::Result<()>` and writes `store.json.tmp-<pid>` then
  `fs::rename`s it. `record_reply` and `decide` answer
  `{"outcome":"refused","code":"store_unreadable"|"store_unwritable"}` on either error.
- verify: a case in the style of `tests/acceptance/138` goldens tests: write `{` to the scenario's
  `goldens/store.json`, call `record`; today the file is replaced and the reply is `recorded`.
- risk: low; suites give each test its own `goldens` folder, created empty (a missing file still reads empty).

### SHOW-9  The GPU lease can be taken by two kits at once, and after five minutes the kit draws without it
- kind: broken
- confidence: LIKELY
- where: crates/deep-show/src/kit/goldens.rs:36-80 (`GpuLease::take`); callers kit/mod.rs:378,
  goldens.rs:386, :406
- evidence: the holder creates the file with `create_new(true)` and then writes its PID in a second step. A
  waiter that fails `create_new` reads the file, and `holder.is_some_and(alive)` is false both for a dead
  PID and for a file it can't parse, so it removes the file and tries again:
  ```rust
  let holder: Option<i32> = std::fs::read_to_string(&file).ok().and_then(|s| s.trim().parse().ok());
  let alive = holder.is_some_and(|pid| ...kill -0...);
  if !alive { let _ = std::fs::remove_file(&file); continue; }
  ```
  After 600 tries it returns `GpuLease(None)` and every caller goes on to draw on the GPU.
- failure: (1) kit A has created the lease file and not yet written its PID; kit B reads an empty file,
  removes A's lease and creates its own; both hold "one kit at a time draws on the GPU". The same happens
  when two waiters see one dead holder: the second removes the first's fresh lease. (2) a kit run longer
  than 300 s holds the lease; a second run waits 600 x 0.5 s, then draws on the GPU anyway with nothing in
  its reply saying so (`"lease": {"gpu": true}` reports the request, not the lease).
- fix: write the PID to `lease.<pid>` and `fs::hard_link` it to `lease` (atomic, fails if it exists), so the
  file is never seen without its PID; remove a stale lease only when a PID was read and is dead. On
  time-out, return the cases `BLOCKED` with probe `gpu_lease` (or at least report `"lease": {"gpu": false}`)
  instead of drawing.
- verify: unit test: create an empty `lease` file by hand, call `take()` from a thread, assert the file is
  still there after one second.
- risk: a stale empty lease file left by a crash between create and write now blocks until removed by hand,
  unless the fix also ages it out; pick one. No test pins the current behavior (`rg -n "deepbuild-gpu" tests`).

### SHOW-10  A `kit` call that runs no module or no part answers PASS, and with `ledger` writes PASS records a release seal admits
- kind: broken (a check that passes with nothing run)
- confidence: QUESTION (the #138 README defines `parts` and "for every module it ran"; it does not say what a
  partial run may write)
- where: crates/deep-show/src/kit/mod.rs:376-472 (`Hub::kit`), :183-187 (`runs`), :614-687 (`judge_part`);
  crates/deep-show/src/kit/ledger.rs:49-58 (`admit` reads `verdict` and `digest` only)
- evidence: `judge_part` is strict for a part that ran (`short_run` when `declared == 0`), but the levels above
  start at `Verdict::Pass`: a module whose every part was filtered out by `parts` or returned `None` keeps
  `verdict = Verdict::Pass` (:410), and with no module matched `overall` stays `Verdict::Pass` (:383). The
  ledger entry is `{"verdict": verdict.name(), "digest": ..., "parts": {...}}`, and `ledger::admit` refuses
  only `record["verdict"] != "PASS" || record["digest"] != m.digest`.
- failure: `{"call":"kit","parts":[],"ledger":"crates/deep-show/kit-ledger.json"}` (or `"parts":["schedule"]`):
  the reply is `"verdict":"PASS"` and the ledger holds PASS at the current digest for every module, so a
  release build seals modules no fuzz, fixture or migration part ran on. `{"call":"kit","modules":["marks2D"]}`
  (a misspelt name): `"verdict":"PASS","modules":[]`, and with `ledger` the file is replaced by `{}`.
- fix: in `Hub::kit`, (1) after the loop, `if modules.is_empty() { overall = Verdict::Invalid; }`; (2) write
  the ledger only when `call.parts.is_none()`, or record `"INCONCLUSIVE"` for a module whose `parts` list is
  not every part its `run_part` answers; (3) a module with `parts.is_empty()` is `Verdict::Invalid`.
- verify: the two scenario lines above through `deep-show run`.
- risk: `tests/acceptance/138` passes `parts` in many cases and reads the module verdicts; change (1) and (2)
  first and read `tests/acceptance/138/README.md:154, :235-238` and `kit.test.ts` before (3).

### SHOW-11  A pack's manifest can name recipe and asset files outside its folder
- kind: broken
- confidence: LIKELY (I did not read `deep_canvas::document::Packs::admit`; `load` runs before it)
- where: crates/deep-show/src/packs.rs:63-70 (`fs::read(dir.join(&path))` for each `assets[].path`), :89-99
  (`read(&dir.join(file))` for each `recipes` entry that is a string)
- evidence: `path` and `file` come from the pack's own `pack.json` and are joined to the pack folder with no
  check. `Path::join` with an absolute path replaces the base, and `..` components walk out of it.
- failure: a pack whose `pack.json` holds `"recipes": {"x@1": "/Users/<you>/.claude.json"}` (or
  `"../../other/file.json"`): `install_pack` parses that file as the recipe and inlines it in the manifest the
  pack check reads, so its content can come back in the check's issues (`actual`). For assets the bytes are
  inlined only when they match the sha256 and size the pack lists, so that half only confirms a guess.
- fix: in `load`, refuse a `path`/`file` that is not a plain relative path before reading it:
  ```rust
  let inside = |p: &str| Path::new(p).components().all(|c| matches!(c, std::path::Component::Normal(_)));
  ```
  and return the existing `ref_unresolved` issue (at `assets/{i}` or `recipes/{kind}`) when `!inside(..)`.
- verify: a pack fixture in the style of `tests/acceptance/306` whose recipe entry is `"../pack.json"`: today
  it loads; after, `refused` with `ref_unresolved` at `recipes/<kind>`.
- risk: a shipped pack that keeps recipes in a parent folder would be refused; none does
  (`rg -n '"\.\./|": "/' packs crates/deep-show/kit-packs -g pack.json` is empty). Fixture packs under
  `tests/acceptance/306` and `238` were not read.

### SHOW-12  A Send is marked `sent` whatever the listener answered
- kind: broken
- confidence: LIKELY
- where: crates/deep-show/src/capture.rs:402-432 (`local_http`, `http`), :654-668 (`deliver`)
- evidence: `local_http` is `host is local && http(url, body).is_some()`, and `http` returns `Some(response)`
  for anything it could read until the peer closed, including an empty response and a `500`. `deliver` sets
  `send.state = if sent { "sent" } else { "failed" }` from that.
- failure: the listener answers `HTTP/1.0 500` (or accepts and closes without answering): the reply is
  `{"send": {"state": "sent"}}`. `table_import` (media.rs:293-298) reads the same `http` and does check for
  `200`, so the two callers disagree.
- fix: in `local_http`, replace `http(url, body).is_some()` with
  `http(url, body).is_some_and(|r| r.starts_with(b"HTTP/1.") && r.get(9..10) == Some(&b"2"[..]))`.
- verify: `tests/acceptance/105/privacy.test.ts` (4) still reads `sent`: its listener
  (`tests/acceptance/105/helpers.ts:395`) answers `r.end('ok')`, a 200. A listener answering 500 reads `failed`.
- risk: `ring.rs:999` (`Op::Fetch`, planted `panel_policy_open`) also calls `local_http`; a planted fetch
  that today counts any answer would need a 2xx. QUESTION until that test's listener is read.

## Nits (one line each; not full findings)

- main.rs:1-8: the module doc lists `deep-show <run | screen | live>`; the binary also takes `canvas`,
  `serve`, `host`, `kinds`, `term-ax`, `decode-worker`, `encode-tool` (README lists most). inconsistent, SURE.
- main.rs:1757-1760 and Cargo.toml:24-27: both say `r2` "adds scene3d and effects"; `modules()` also adds
  `cells` (:1794) and `vector` (:1816) at R2, and `schedule/r2.json` holds them. inconsistent, SURE.
- main.rs:2731-2841: an unknown or missing subcommand (`deep-show rnu`) is not refused: it seals the full set,
  answers `bad_input` to every stdin line and exits 0; with empty stdin it prints nothing. QUESTION (the 393
  README only defines `run | screen`).
- main.rs:1097-1109: a `fault` object with `kill_at` (or a commit fault) and also `holds`/`ms` drops the hold
  silently; a combination accepted and half ignored. Test seam only.
- main.rs:629: `frames`' `count` is cut to 100,000 without saying so (`.min(100_000)`); every other bound
  in `call()` refuses.
- main.rs:1704-1755 (`TEST_BUILD`): omits features that also add a test canvas module (`test-title-cap`,
  `test-deprecated`, `test-mark*`, `test-fill-*`, `test-mode-*`, `test-gpustep*`, `test-rules-*`,
  `test-registries-load`, `test-column-source`, `test-probe*`, `test-machines`, `test-control-kind`), so those
  builds keep no access log. QUESTION: may be on purpose (only #387's suites read the log).
- main.rs:144-175 (`base64`): accepts `=` padding inside the text (`"QQ==QQ=="` decodes), though the doc says
  RFC 4648 or `None`.
- main.rs:2828: `canvas` starts with `evidence: ""`, so a `call` line sent before any `world` line writes
  evidence files relative to the working folder. The hub always sends the world first.
- serve.rs:498, :894-898 and host.rs:28-32, :139: `cols`/`rows` are cut to `u16` with `as` (`65536` becomes
  0, then 1 in the emulator and 0 in the PTY's winsize) instead of being refused.
- serve.rs:253-259: `argv` entries that are not strings are dropped (`["sh", 5, "-c"]` runs `sh -c`); and
  :332-338 a panel `rect` drops non-numbers before counting four.
- serve.rs:900: `terminal_resize` answers `resized: true` whatever the host's reply to the resize query was.
- host.rs:48-49: a frame's 32-bit length is trusted: `buf.resize(len, 0)` allocates up to 4 GiB on a corrupt
  header; and :102-108 `from + count` can overflow in a dev build.
- kinds.rs:1246-1262: `--planted` given twice keeps the last without refusing; :1279-1280 the dump file,
  named by its digest, is written in place (a crash leaves a short file under a valid name).
- kit/mod.rs:449-460: the ledger write is unchecked (`let _ = std::fs::write`) and in place; the kit's reply
  is the same whether the ledger was written. It fails closed (a short ledger refuses every module in a
  release build), so only the silence is the nit.
- kit/goldens.rs:466-470 (`first_oracle`): `o.checks().into_iter().all(..)` is true for a fixture with
  `expected_from` and no checks, so one with nothing to check can stand as a first oracle. QUESTION.
- capture.rs:365-382 (`append`): the record append's errors are dropped, so a capture reads `saved` with its
  `capture.saved` event missing; `shared.rs:1168-1175` checks the same append and fails the commit.
- media.rs:224-228: when the evidence store takes no write the proxy reply carries `"sha256": null` and no
  refusal; :266-272 a failed frame write returns before the scratch folder is removed.
- media.rs:339-341: `tables/<sha>.json` is written in place, not temp-then-rename as `evidence::put` does.
- efficiency.rs:178-196: `page.limit: 0` answers no rows and a `next` equal to the cursor given, so paging
  until `next` is null never ends.
- video.rs:71-78 (`evidence_path`): builds the path from an unvalidated `sha` (an absolute second half would
  replace the root); today the image check refuses a non-hex `asset` first (`bad_asset`,
  deep-canvas-marks scene.rs:4862). `evidence::read` validates; this helper should too.
- mixdown.rs:173 clamps a source's channels to 1..2 while gate.rs:448 takes any count: a 6-channel asset is
  mono-mixed by one and read as stereo by the other. QUESTION (depends on what the decode worker emits).
- evidence.rs:17-19: `put` returns early when the file exists without checking it still hashes to its name,
  so a damaged file under a hash is never repaired (`read` then returns `None` for good).
- tests/shared.rs:38, :58 and tests/view_clock.rs:39-40, :65: every test of the file shares one evidence
  folder (`...-<pid>`) and removes it at its end, while libtest runs them in parallel. No assertion reads the
  folder today.
- No `doneright` name is left in the crate (`rg -ni doneright crates/deep-show` is empty).

## Checked and found in order (so nobody re-checks)

- Cargo features: all 137 declared features are read by a `cfg` in `src/` (the 36 `test-kit-*` ones through
  the `with!` macro in kit/modules.rs:1481-1521), no `cfg(feature)` names an undeclared one, and every feature
  but the umbrella `test-sim` is named by a file outside the crate (tests/acceptance READMEs and helpers).
- Cargo dependencies: every one is used (`gpui-pre-apple` as `gpui_apple`, `gpui-pre-macos` as `gpui_macos`).
- Subcommands: `run`, `screen`, `live`, `canvas`, `serve`, `host`, `kinds`, `term-ax`, `decode-worker`,
  `encode-tool` each have a caller outside `main.rs`. The `out` field of a `canvas` call looked unused (the
  hub never sends it) but `tests/acceptance/806/replay393.test.ts:66` does, through the replica's `canvas.user`.
- Data files: `kit-ledger.json` (18 modules, all PASS; names match `schedule/modules/*.json` less the test
  modules), `schedule/{core,r1,r2,full}.json` (main.rs test), `schedule/modules/*.json` (kit `schedule` part,
  each file's `module` equals its name), `kit-corpus/` (default `corpus` of the kit, and #492),
  `kit-packs/test-chart-1.0.0` (kit/catalog.json, #306), `gallery/*` (kinds.rs, hub.rs, tests/gallery.rs; both
  example hashes in `gallery.json` equal the files' SHA-256). None is orphaned. Whether the ledger's digests
  are the current modules' digests cannot be told without a build.
- `#[allow(dead_code)]`: twins.rs:151 (a field read through `Debug`) and kit/modules.rs:7 (feature-gated
  modules; no function there is named only once).
- The hub cannot pass stray fields into a canvas call from an agent: `deep_kinds` and `deep_show` arguments
  go through `checkArguments` (schemas with `additionalProperties: false`), and `canvas.user` is app-only.

## Ranked, worst first

1. SHOW-1 PTY masters inherited by every later child (SURE)
2. SHOW-8 golden store lost on a bad read; unchecked, in-place write (SURE)
3. SHOW-10 kit PASS and a PASS ledger with nothing run (QUESTION)
4. SHOW-7 stale or shared video frame pictures (LIKELY)
5. SHOW-5 `batch` length overflow (SURE)
6. SHOW-4 non-UTF-8 line ends the run silently (SURE)
7. SHOW-9 GPU lease taken twice or skipped (LIKELY)
8. SHOW-2 600 s wait on a dead host (LIKELY)
9. SHOW-3 `terminal_open` twice leaks processes (LIKELY)
10. SHOW-11 pack files outside the pack folder (LIKELY)
11. SHOW-12 Send `sent` on any answer (LIKELY)
12. SHOW-6 `scale` of the wrong type read as 1.0 (LIKELY)

Cross-area, for the hub's reader (not mine, one line each): `packages/hub/src/canvas.ts:139-153` attaches no
`error` listener to the child or its stdin, so a spawn error or a write after the core exited is an uncaught
exception in the hub; and a restarted core starts with an empty call log, so every document's revisions are
gone after `canvas_core_exited`.

## Coverage

I ran out of room before reading every source file. The brief's sub-readers could not be started (the
session's agent limit was reached), so one reader covered 41k lines. What was and was not read:

| Read in full | main.rs, serve.rs, host.rs, capture.rs, media.rs, video.rs, evidence.rs, jobs.rs, workers.rs, runs.rs, packs.rs, access.rs, kit/ledger.rs, kit/mod.rs, build.rs, Cargo.toml, README.md, tests/serve_answers.rs, tests/gallery.rs, gallery/*.md, gallery/gallery.json |
| Read in part (the lines named) | window.rs (251-447), kit/goldens.rs (20-100, 240-480), kit/order.rs (245-305), kit/migration.rs (90-150), kit/fuzz.rs (215-245), kit/modules.rs (1-40, 1476-1523), kinds.rs (1225-1304), time.rs (1-162, 385-445), verdict.rs (1-330), efficiency.rs (170-222), frames.rs (196-232, 296-470), snapshot.rs (225-245, 355-470), hub.rs (1700-1740, 2060-2090, 2150-2172, 2440-2520), shared.rs (1105-1185), ask.rs (280-345, 401-424), input.rs (355-405), gate.rs (425-465), mixdown.rs (150-180), tests/shared.rs (33-62), tests/view_clock.rs (36-76) |
| Grepped only (casts from JSON numbers, `expect`, file writes, `allow`, feature gates) | the rest of hub.rs, shared.rs, watch.rs, query.rs, gate.rs, ask.rs, frames.rs, ring.rs, kinds.rs, snapshot.rs, placement.rs, modes.rs, efficiency.rs, time.rs, costs.rs, geometry.rs, scene3d.rs, registries.rs, function.rs, terminal.rs, input.rs, audio.rs, mixdown.rs, film.rs, sandbox.rs, live.rs, idle.rs, seams.rs, spatial.rs, familiar.rs, shaper.rs, planted.rs, twins.rs, test_machines.rs, test_registries.rs, test_threads.rs, kit/{catalog,carried,compare,engine,fixtures,fuzz,gpu,instance,interface,manifest,migration,order,repair,time_order,modules}.rs |
| Data files | schedule/*.json, schedule/modules/*.json, kit-ledger.json: checked by script for names and loaders, not line by line; kit-corpus and kit-packs: loaders only |
| Tests | tests/{arranged_screen,capture,composites,full_screen,render_back_pipeline}.rs: headers and helpers only |

Not verified by running anything: every finding is from the code. The `printf`/scenario lines under
"verify" were not executed (no builds allowed).
