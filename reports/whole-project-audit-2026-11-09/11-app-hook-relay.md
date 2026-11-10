# rust-app: findings

Area: `crates/deep-hook`, `deep-relay`, `deep-panel-host`, `deep-contracts`, `deep-replica`, `deep-app`, and the
workspace files. Checkout `whole-project-audit-1109` at 06fd33cd. Read-only: nothing was built or run, so every
finding is from reading the code, its callers and its tests. Three sub-readers I tried to start for deep-app and
deep-replica were refused (the session was at its subagent cap), so this is one reader's pass; the coverage table
at the end says what was read in full and what was not.

Sixteen findings: 9 broken, 6 inconsistent, 1 unneeded, 0 inefficient (speed was just swept). By confidence: 6 SURE
(2 in part, 5, 7, 11, 13, 16 in part), 9 LIKELY (1, 3, 4, 6, 8, 9, 12, 14, 15), 1 QUESTION (10).

Ranked worst first across the area: 1, 2, 13, 3, 4, 14, 7, 8, 15, 9, 16, 10, 12, 6, 5, 11. The sections below are by
crate, in the order the brief names them, so the IDs are stable and are not the rank.

Safe to apply by hand as written (small, SURE, no test pins the old behavior): 7 (relay URL port), 13 (the two
arms in `View::apply`), the aws part of 2, and the two README lines (5, 11). Everything else needs a design call or
a build to confirm.

---

## deep-hook

### RUST-APP-1  A deeply nested command line overflows deep-hook's stack: the hook aborts, and the call runs unguarded
- kind: broken
- confidence: LIKELY (the unbounded recursion is certain from the code; the depth that overflows was not measured, nothing was run)
- where: `crates/deep-hook/src/shell.rs:365-417` (`Lexer::tokens`), `:515-560` (`word`), `:606-631` (`dollar`), `:665-725` (`brace`), `:1006-1012` (`Reader::script`), `:1089-1223` (`Reader::command`); `crates/deep-hook/src/main.rs:1181-1188` (the panic hook)
- evidence: `Reader::script` checks `ctx.depth > DEPTH` and then lexes the whole text at once:
  ```rust
  let toks = Lexer::new(text).tokens(false);
  ```
  The lexer recurses once per nesting level with no bound: `tokens` → `word` → `dollar` → `Some('(') => { self.i += 1; let sub = self.tokens(true); … }`, and `brace` → `dollar` → `brace` for `${a:-${a:-…}}`. `DEPTH` (12) is only counted later, in `Reader::value` (`inner.depth += 1` per `Part::Sub`) and `Reader::shell`. The reader's own compound commands recurse without a count too: `command` on `(` calls `self.list(cur, &mut sub, …)` → `and_or` → `pipeline` → `command`, and the same for `{`, `if`, `while`, `for`, `case`; `ctx.depth` is not touched there. `forward` runs all of this on the main thread (8 MiB stack). `rg -n 'stack|overflow|repeat\(' crates/deep-hook` finds no guard and no test. #1407 closed the panic path ("Rust's exit 101 blocks nothing", main.rs:1180) with a panic hook; a stack overflow is not a panic: Rust's handler prints "has overflowed its stack" and aborts the process (SIGABRT), so the panic hook and the watchdog thread never decide.
- failure: a Bash PreToolUse whose command is `pkill -f node` + newline + `$(` repeated some tens of thousands of times (tens of KB; the second line need not be valid shell, bash runs the first line before it parses the second). deep-hook dies by signal before it matches or reaches the hub. Claude Code and Codex treat a hook exit that is not 2 as a non-blocking error, so the call runs: every `fail_closed` entry (`no-kill-by-name`, `no-deepbuild-home-write`, …) is skipped, with the hub up or down, and nothing is recorded or spooled. #1097's own criterion is that a line nesting past what the reader reads is denied, never allowed (`tests/acceptance/1097/depth.test.ts`).
- fix: not a one-line edit. Give `Lexer` a `depth: usize` counted where it re-enters itself (`dollar`'s `$(`, `word`'s `<(`/`>(`, `substitutions`, and `brace`'s default → `dollar`), and count the reader's compound recursion (`command`'s `(`, `{`, `if`, `while`/`until`, `for`, `case`) the same way. Past a bound (the existing `DEPTH`, or a larger one for syntax-only nesting), stop reading and record the run `Reader::too_deep` records (`unread: Some(Unread::Depth)`), which every entry already meets (`matcher.rs:233-240`).
- verify: a case in `crates/deep-hook/tests/cli.rs` beside `a_call_still_unread_at_the_deadline_is_denied…`: `no-kill-by-name` installed, no hub, command `"pkill -f x\n" + "$(".repeat(200_000)`; it must exit 2. Today the child ends by signal.
- risk: a legitimate line nested past the new bound becomes unread (denied by fail-closed entries with the hub away), as a 13-deep `sh -c` already is. `tests/acceptance/1097` pins 12 deep as read and 13 as unread for `sh -c` nesting; a separate, larger bound for syntax nesting leaves that as it is.

### RUST-APP-2  An option's value is read as the subcommand, so effect entries miss common spellings (`aws --profile p kms create-key`, `docker compose -f x.yml up`, `gh pr -R o/r merge 12`)
- kind: broken
- confidence: SURE for the `aws` and `docker compose` cases (the code path is unambiguous); LIKELY for `gh` (it rests on gh accepting `-R` before the subcommand, which I could not run)
- where: `crates/deep-hook/src/matcher.rs:783-789` (`plain`), `:1103-1123` (`creates_cloud`), `:1299-1303` (`gh`), `:1383-1397` (`adds_dependency`), `:1400-1411` (`starts_service`), `:1360` (`merge_read`'s `plain(&words).get(2)`)
- evidence: `plain` drops only words that start with `-`:
  ```rust
  fn plain<'a>(words: &[&'a str]) -> Vec<&'a str> {
      words.iter().copied().filter(|w| !w.starts_with('-')).collect()
  }
  ```
  so the value of a spaced option stays as a positional word. `creates_cloud` then reads the operation by position: `let o = op(1); … ["create-", "run-", "allocate-", "request-", "import-"].iter().any(|p| o.starts_with(p))`. For git, jj, sl, gt and glab the file already skips valued global options (`sub()` with `past(&words, valued)`, matcher.rs:1169-1186); aws, gh, npm, docker and pulumi have no such list. Every test and acceptance fixture puts `--profile` after the operation (`rg -n 'aws --|--profile' crates/deep-hook tests`: only `aws kms create-key --profile …`), so nothing pins the miss.
- failure:
  - `aws --profile shop-prod kms create-key` → words `[--profile, shop-prod, kms, create-key]`, plain `[shop-prod, kms, create-key]`, `op(1)` is `kms` → `effect:cloud-resource` does not match. `no-unnamed-cloud-resource` is `fail_closed: true, mode: block` in `default-rules.json`; the call runs unasked with the hub up and undenied with it down. Same for `aws --region us-east-1 ec2 run-instances` and `aws --region r s3 mb s3://b`. main.rs's own `cloud_owner` (main.rs:260-291) expects `--profile` anywhere on the line.
  - `docker compose -f docker-compose.dev.yml up -d` → plain `[compose, docker-compose.dev.yml, up]`, `op(1)` is the file → `effect:service` misses (record-new-service).
  - `npm --prefix web install left-pad` → `plain.first()` is `web` → `effect:dependency` misses.
  - `pulumi --cwd infra up` / `pulumi -C infra up` → `op(0)` is `infra` → misses.
  - `gh pr -R acme/shop merge 12` or `gh pr --repo acme/shop create` → plain `[pr, acme/shop, merge, 12]`, `plain[..2] != [pr, merge]` → `effect:merge`, `effect:pr`, `effect:send`, `effect:delete` miss, so the authority gate (`merge-needs-ask`, `pr-needs-ask`) is not asked. With the option after the verb (`gh pr merge -R acme/shop 12`) it matches, but `merge_read` reports `pr=acme/shop` (`plain(&words).get(2)`), so `merge-names-head` reads the wrong pull request.
- fix: skip each tool's valued options before reading positions, as `sub()` does. Smallest safe step, for aws (leading global options only, so every spelling that matches today reads the same):
  ```rust
  if run.is("aws") {
      let o = op(1);
  ```
  →
  ```rust
  if run.is("aws") {
      // aws's global options that take a value come before the service as often as after it.
      const AWS_VALUED: &[&str] = &["--profile", "--region", "--endpoint-url", "--output", "--query", "--color", "--ca-bundle", "--cli-read-timeout", "--cli-connect-timeout", "--cli-binary-format"];
      let rest = past(&words, AWS_VALUED);
      let plain = self::plain(&rest);
      let op = |k: usize| plain.get(k).copied().unwrap_or("");
      let o = op(1);
  ```
  (`past` is at matcher.rs:1673.) The gh, docker, npm and pulumi cases need the same treatment with each tool's valued flags (gh: `-R/--repo`, and per-verb flags such as `-b/--body`, `-t/--title`, `-F/--body-file` before the PR number for `merge_read`; docker: `-f/--file`, `-p/--project-name`, `--context`, `-H`; npm: `--prefix`, `-C`, `-w`; pulumi: `--cwd/-C`, `-s/--stack`).
- verify: add to the table test at `crates/deep-hook/src/matcher.rs` (the `effect` tests near line 2100+): `bash("aws --profile p kms create-key").matches("effect:cloud-resource").is_some()`. Fails today.
- risk: over-matching only if a listed flag is in fact boolean for some tool version; a missed flag leaves today's behavior. No test pins the misses.

### RUST-APP-3  A joined hub's spool is stuck for good after one cut or refused line: later hooks never reach that hub
- kind: broken
- confidence: LIKELY (both sides read; it needs a cut line to exist, which `append`'s own comment says happens)
- where: `crates/deep-hook/src/remote.rs:428-452` (`send_spool`); `crates/deep-hook/src/main.rs:1053-1057` (`append`: "A short write leaves a cut line, which the hub skips"); `packages/hub/src/server.ts:679-695` (spool connection), `packages/hub/src/spool.ts:95` (the local replay skips a cut line)
- evidence: the sender returns at the first line the hub does not acknowledge, before it removes the file:
  ```rust
  if io::BufRead::read_line(&mut reader, &mut line).unwrap_or(0) == 0 || !line.contains("\"ack\"") {
      return ExitCode::from(1);
  }
  ```
  On a spool connection the hub acknowledges only a line that parses as a hook (`server.ts:679-685`); any other first line is refused and the connection ended (`:691-694`). The machine's own hub skips a cut line and records it once (`spool.ts:95`: "a cut line: a spooled write that never finished"); the remote sender has no such path. Files are sent oldest first (`files.sort()`), and `send_later` only fires while a live `spool.jsonl` exists (`remote.rs:346`).
- failure: a clone of a joined project, link down; one hook's spool write is cut (disk full, or the hook is ended mid-write), leaving a line that is not JSON in `~/.deepbuild/spool/<hub>/spool.jsonl`. When the link is back, `spool-send` renames it to `held-…jsonl`, sends the lines before the cut one, gets a refusal for the cut one and exits 1. Every later `spool-send` starts with that same oldest file and stops at the same line, so its later lines and every newer `held-*.jsonl` are never sent: those hooks are missing from the project hub's record with no error anywhere (stdout and stderr are `Stdio::null()`).
- fix: skip what can never be acknowledged, as the local replay does. In `send_spool`:
  ```rust
  let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
  ```
  →
  ```rust
  // A cut line parses nowhere: skipped, as this machine's own hub skips one, so it can't hold later hooks back.
  let lines: Vec<&str> = text.lines().filter(|l| parse(l.trim()).is_ok()).collect();
  ```
  (This drops a request that was appended straight after a cut line on the same line; `spool.ts` recovers that one by its `{"v":1,"agent":` start, and the sender could do the same.)
- verify: no test covers `send_spool` (`rg -n 'spool-send|send_spool' crates tests packages`: only the two call sites and `tests/acceptance/1338`); a unit test that writes a held file `"{cut\n{\"v\":1,…}\n"` and a fake TLS hub is the smallest proof. Not run.
- risk: a line the hub refuses for another reason (over its 64 MiB line limit) still stops the file; none known.

### RUST-APP-4  With the hub down, a standing rule for one AWS account lets a create in another account through: the owner is read from the line's first `--profile`, not from the run that creates
- kind: broken
- confidence: LIKELY (hook side certain from the code; the hub reads the owner the same way in `packages/hub/src/standing.ts:33-39`, which is another reader's file)
- where: `crates/deep-hook/src/main.rs:260-291` (`cloud_owner`), `:559-569` (`covered`), `:572-576` (`denials`)
- evidence: `cloud_owner` splits the raw command on whitespace, requires only that the first word is `aws`, and takes the first `--profile` anywhere on the line (`words.iter().position(|w| *w == "--profile" || w.starts_with("--profile="))`), defaulting to `default`. `denials` then drops the fail-closed denial of every `effect:cloud-resource` entry when that owner is in `rules.standing`. The matcher, though, matches a creating run anywhere on the line.
- failure: standing rule covers account 1111 (profile `dev`). Command `aws s3 ls --profile dev; aws kms create-key --profile prod`: `effect:cloud-resource` matches the second run, `cloud_owner` answers `aws:1111`, `covered` is true, the denial is dropped and the key is created in prod with the hub away. Also `aws kms create-key` with `AWS_PROFILE=prod` set in the session's environment: the owner is read as `default`.
- fix: read the owner from the run the matcher matched (its own `--profile`, and `AWS_PROFILE` from `run.env` or the hook's environment), and treat a line with more than one creating run, or creating runs under different owners, as not covered. This needs a small API on `matcher::Call`; it is not a hand edit. The hub's `cloudOf` should take the same answer.
- verify: `tests/acceptance/23/permissions` drives this path with one command per line; a case with two `aws` runs under different profiles would fail today.
- risk: none to what is pinned: the single-run spellings read the same.

### RUST-APP-5  README says deep-hook imports "deep-contracts and std, nothing else today"; it links rustls and ring
- kind: inconsistent
- confidence: SURE
- where: `crates/deep-hook/README.md:17` against `crates/deep-hook/Cargo.toml:10-12` and `crates/deep-hook/src/remote.rs:18-21`
- evidence: README: "Core, beside the hub: deep-contracts (through its crate root) and std, nothing else today, with the few libc calls it makes declared in its own `extern "C"` blocks." Cargo.toml: `rustls = { version = "0.23", … }`, `ring = "0.17"` (#1338). The README's file list also leaves out `src/remote.rs`, `src/heavy.rs`, `src/actions.rs` and `src/inline.rs`, and its Deviations line names the plant features of "#16, #304, #315 and #316" while Cargo.toml has them for #1097, #1407, #1503 and #1676 too.
- fix: README.md line 17, old → new:
  `Core, beside the hub: deep-contracts (through its crate root) and std, nothing else today, with the few libc calls it makes declared in its own \`extern "C"\` blocks.`
  → `Core, beside the hub: deep-contracts (through its crate root), std, and rustls with ring for a joined project's hub over TLS 1.3 (#1338, src/remote.rs), with the few libc calls it makes declared in its own \`extern "C"\` blocks.`
- verify: diff review (docs only).
- risk: none.

### RUST-APP-6  deep-hook turns on rustls's `tls12` feature and speaks TLS 1.3 only
- kind: unneeded
- confidence: LIKELY (certain from the code that deep-hook never uses TLS 1.2; that rustls 0.23 builds this code without the feature was not compiled)
- where: `crates/deep-hook/Cargo.toml:11`; `crates/deep-hook/src/remote.rs:232-239, 272-274`
- evidence: `features = ["ring", "std", "tls12"]`, while the only config deep-hook builds is `.with_protocol_versions(&[&rustls::version::TLS13])` and its `verify_tls12_signature` returns `Err("TLS 1.3 only")`. `rg -n 'TLS12|tls12' crates/*/src`: only that refusal. deep-relay is different and keeps the feature: its relay and its macOS backend use `with_safe_default_protocol_versions()` (`crates/deep-relay/src/bin/deep-relay.rs:42`, `src/macos.rs:101`), which offers 1.2.
- failure: nothing in deep-hook uses TLS 1.2; the feature compiles the 1.2 handshake into the binary that starts on every tool call. Cargo unifies features across a build, so this changes `cargo build -p deep-hook` (how the release hook is built), not a whole-workspace build, where deep-relay turns the feature on anyway.
- fix: `features = ["ring", "std", "tls12"]` → `features = ["ring", "std"]` in `crates/deep-hook/Cargo.toml` only.
- verify: `cargo build -p deep-hook` (not run: no cargo allowed in this audit).
- risk: `ServerCertVerifier::verify_tls12_signature` is a required trait method with or without the feature, so the impl stays.

Nits (deep-hook):
- `main.rs:649`: `deep-hook match` sets `CWD` once (`OnceLock`), so in a long-lived matcher the first line's `cwd` picks the dev hub (`worktree_hub`) for every later line. One process per pi session, whose folder does not change: left as is.
- `main.rs:716-741` `read_line`: the socket timeout is set once per line, and `BufReader::read_line` may make several reads, each with the whole remaining time; a hub that dribbles bytes can hold an acknowledged hook past its hold. The hub is trusted and the watchdog covers the time before the acknowledgement.
- `heavy.rs:254-257`: any run named `lease`, or `deep lease`, anywhere on the line makes the whole line match no heavy entry (`deep lease -- true; cargo test --workspace` runs unleased). It is a courtesy rule, not a guard.
- `default-rules.json` `no-approval-tag-sign`/`-push` are `shell:` globs over the raw line (`*git* tag *deep/approved/*`), so a tab between `git` and `tag` reads as no match; the other entries read through the shell reader.
- `shell.rs:609-626`: `$((` is always read as arithmetic to its closing parenthesis count; bash reads `$((cmd); cmd2)` as a command substitution, so a run inside one is not read. Obscure on purpose only.

---

## deep-relay

### RUST-APP-7  A relay URL with no port can never be opened: `https://relay.example.com` fails as "can't be resolved: invalid socket address"
- kind: broken
- confidence: SURE
- where: `crates/deep-relay/src/macos.rs:38-41` (`host`), `:105-112` (`Connection::open`); callers `crates/deep-relay/src/suite.rs:174, 377`, `crates/deep-show/src/seams.rs:310`
- evidence:
  ```rust
  let name = host.rsplit_once(':').map_or(host.as_str(), |(n, _)| n);
  …
  let addr: SocketAddr = host
      .to_socket_addrs()
      .map_err(|e| fail(format!("can't be resolved: {e}")))?
  ```
  `host("https://relay.example.com")` is `relay.example.com`. `str::to_socket_addrs` needs `host:port` and answers `InvalidInput: invalid socket address` without one. The code already treats the port as optional when it builds the TLS name (`map_or(host.as_str(), …)`). The README tells you to run the relay on 443 (`deep-relay --listen 0.0.0.0:443`), the suite's usage is `--relay https://<host>`, and the contract calls the relay "a WebSocket over https". Every caller in the repo passes `https://127.0.0.1:<port>` (`scripts/relay-kit.mjs:58`, `tests/acceptance/309`), so nothing pins or exercises the port-less form.
- failure: `deep-relay-suite --relay https://relay.example.com --ca ca.pem` (a relay on the standard port, as the README sets one up) → `the relay relay.example.com can't be resolved: invalid socket address`; the same for a piece that declares that URL.
- fix: in `Connection::open`, old:
  ```rust
          let addr: SocketAddr = host
              .to_socket_addrs()
  ```
  new:
  ```rust
          // https's own port when the URL names none.
          let authority = if name == host { format!("{host}:443") } else { host.clone() };
          let addr: SocketAddr = authority
              .to_socket_addrs()
  ```
- verify: a unit test beside `the_hello_check_names_the_host…`: `Connection::open("https://localhost", b"")` must fail with "is unreachable" (or connect), not "can't be resolved: invalid socket address".
- risk: none for a URL with a port. An IPv6 literal (`https://[::1]:443`) is still refused as "isn't a host name"; unchanged.

### RUST-APP-8  One copy that stops reading makes the relay queue its match's frames without bound, and its thread never notices
- kind: broken
- confidence: LIKELY (from the code; not run)
- where: `crates/deep-relay/src/relay.rs:125, 136, 140, 169-173` (`connection`), `:256-269` (`forward`)
- evidence: each connection's outbox is an unbounded `std::sync::mpsc::channel()`; `forward` does `tx.send(Message::binary(frame.to_vec()))` for every other seat and never blocks. The socket gets a read timeout (`set_read_timeout(Some(HANDSHAKE))`, then `POLL`) and no write timeout, so the seat's own thread sits in a blocking `ws.send(message)` once the peer's TCP window is full, and stops reading and draining. Nothing bounds or closes it.
- failure: a copy joins a two-seat match and stops reading its socket (a suspended tab, or on purpose). Its peer sends at the allowed 240 frames/s of up to 65,536 B: the relay holds up to about 15 MiB more per second for that one seat until the process is killed for memory. The same blocked thread also means a handshake that dribbles bytes holds a thread for good (`HANDSHAKE` is a per-read timeout; there is no connection cap).
- fix: give the socket a write timeout, and bound the outbox: `sync_channel(n)` with `try_send`, and a seat whose outbox is full is closed like one past its limits (`leave(…, "rate")` or a reason of its own; a new reason is a relay@2 shape, so reuse one relay@1 names). Not a hand edit: it changes what a slow peer sees.
- verify: `tests/acceptance/309` plus a suite check with a copy that joins and never reads; today the relay's memory grows and the copy is never closed.
- risk: a bound that is too small closes slow but honest copies; relay@1's repeat rule (frames repeat until confirmed) already tolerates dropped frames, so dropping instead of closing is also within the contract.

### RUST-APP-9  The relay suite's report says PASS for checks it never ran
- kind: inconsistent (with AGENTS.md invariant 2: "Nothing missing or unrun passes")
- confidence: LIKELY (the overall status is still FAIL; `tests/acceptance/309/relay-suite.test.ts:60-62` reads per-check statuses only on a relay that passes)
- where: `crates/deep-relay/src/suite.rs:344-347` (every check starts as an empty list), `:350-353` (`play`'s error goes to `joining`), `:354-364` (an empty list is PASS)
- evidence:
  ```rust
  checks: ["hello", "joining", "forwarding", "keeps_nothing", "closing"].into_iter().map(|c| (c, vec![])).collect(),
  …
  let status = if failures.is_empty() { "PASS" } else { "FAIL" };
  ```
  `play` returns at its first `?` (the first `Connection::open`, any `join`, `exchange`…), and what follows it never runs.
- failure: the relay is unreachable. The report is `{"status":"FAIL","hello":{"protocol":null,"digest":null},"checks":{"hello":{"status":"PASS",…},"joining":{"status":"FAIL",…},"forwarding":{"status":"PASS"},"keeps_nothing":{"status":"PASS"},"closing":{"status":"PASS"}}}`: four checks pass on a relay that never answered, `hello` among them.
- fix: in `run`, old:
  ```rust
      let played = play(&mut run);
      if let Err(e) = played {
          run.fail("joining", e);
      }
  ```
  new:
  ```rust
      let played = play(&mut run);
      // A run that stopped early ran only some checks: one with no failure by then is not a pass.
      let stopped = played.is_err();
      if let Err(e) = played {
          run.fail("joining", e);
      }
  ```
  and `let status = if failures.is_empty() { "PASS" } else { "FAIL" };` → `let status = if !failures.is_empty() { "FAIL" } else if stopped { "INCONCLUSIVE" } else { "PASS" };`
- verify: `deep-relay-suite --relay https://127.0.0.1:9 --ca <any pem>`: no check may say PASS.
- risk: `scripts/relay-kit.mjs:122` lists every check whose status isn't PASS and reads `c.failures.slice(0, 3)`; an INCONCLUSIVE check has an empty `failures`, which prints an empty line, nothing more.

Nits (deep-relay):
- `relay.rs:151-158`: only binary frames count against `frames_per_s` and `frame_bytes`; `signal` text messages are handed on at any rate and size (tungstenite's 64 MiB default), so a copy can flood a peer of its own match past both limits.
- `relay.rs:256-264`: a frame sent before `start` is forwarded and marks the match `forwarded`, so the seats still free are refused `started`. The contract only says "no copy sends a frame before it".
- `relay.rs:211-213`: a join with a bad match ID or player count, or a second join on a seated connection, gets no answer at all; the suite and the backend both wait their full 10 s.
- `macos.rs:176-180` `close`: `while self.ws.read().is_ok() {}` has no deadline; a relay that keeps sending and never closes holds the caller.

---

## deep-panel-host

Read in full (`src/lib.rs`, `main.rs`, `jit_control.rs`, README, Cargo.toml). The JIT switch and heap cap run before anything else; a bad stdin line or a closed stdout ends the host. No finding I can stand behind beyond these two questions:

### RUST-APP-10  `verdict` answers PASS for a panel that was never rendered
- kind: inconsistent (invariant 2)
- confidence: QUESTION
- where: `crates/deep-panel-host/src/lib.rs:321-334`
- evidence: `let max = command["max_frames"].as_u64().unwrap_or(0); let frames = panel.frames_since_invalidate; let fail = frames > max;` and `"status": if fail { "FAIL" } else { "PASS" }`. `frames_since_invalidate` is 0 until a first `invalidate`, and a missing or non-numeric `max_frames` is read as 0.
- failure: `{"cmd":"verdict"}` as the first command: `PASS … drew 0 frames since its last invalidation against 0 allowed`, with `renders` still 0: nothing was observed.
- fix: answer `INCONCLUSIVE` when `panel.seen == 0` (no render was ever looked at) or `max_frames` is absent. Whether #1492's suite sends `verdict` before an `invalidate` on purpose I did not check (`tests/acceptance/1492`), hence QUESTION.
- verify: `tests/acceptance/1492`.
- risk: the acceptance suite may pin PASS for an idle panel.

Nit: `crates/deep-panel-host/src/lib.rs:68-72` hashes a tree with `DefaultHasher`, whose algorithm std does not promise across releases. The hash is compared only inside one host process (`look`, `invalidate`), so it is fine as long as nothing stores it; `frame.hash` and `stats.hash` do leave the process.

---

## deep-contracts

`src/generated.rs` is written by `packages/contracts/src/generate.ts` (`generateRust(listSchemas())`, run by `npm run generate -w @deepbuild/contracts`). Checked by reading, not by running the generator: the file's last commit is the last commit that touched `packages/contracts/schemas` (01029eee, Nov 9), after the generator's last change (c2b78aa7, Nov 4); its `roundtrip` has one arm per published schema (259 arms against 259 schema files once the eight `*.machine@1.json` lifecycle tables, which `schemas.ts:15` leaves out, are set aside; `diff` of the two sorted lists shows only those eight). `tests/acceptance/603/codegen.test.ts` holds it equal to the generator. `src/lib.rs` and `tests/jcs.rs` are changed by PR #2051 (F4); nothing proposed there.

### RUST-APP-11  README says the generated file has 46,000 lines; it has 71,655
- kind: inconsistent
- confidence: SURE
- where: `crates/deep-contracts/README.md:21`; `wc -l crates/deep-contracts/src/generated.rs` → 71655
- evidence: "`src/generated.rs`: a 46,000-line generated file checked in, under …"
- fix: `a 46,000-line generated file` → `a generated file of about 72,000 lines` (or drop the number, which goes stale with every schema).
- verify: diff review.
- risk: none.

---

## Workspace files

`Cargo.toml` has no `[workspace.dependencies]`, `[workspace.package]` or `[workspace.lints]`, and no crate has a `[lints]` table, so there is nothing unused there. Its 39 members are the 39 folders under `crates/`. Every `[profile.dev.package.<name>]` names a package in `Cargo.lock`. `Cargo.lock` (1,132 packages, read with a script that only parses it): no registry or git package is without a dependent; 133 names have more than one version, nearly all from upstream trees (two wgpu/naga majors from gpui-pre-wgpu against ours, two cranelift lines from quickjs-jit against wasmtime, the windows-* family). `.cargo/config.toml`'s five patches each point at a folder under `vendor/` that exists. `lean-toolchain` and `rust-toolchain.toml` were read; nothing to report on them alone.

### RUST-APP-12  Seventeen crates declare `rust-version = "1.95"`, twenty-two declare none, and the toolchain is pinned to 1.99.1
- kind: inconsistent
- confidence: LIKELY (harmless today; a setting that differs across crates for no stated reason)
- where: `rust-toolchain.toml:2` (`channel = "1.99.1"`); `rust-version = "1.95"` in deep-app, deep-replica, deep-panel-host, deep-show, deep-gpu, deep-gpu-layer, deep-canvas-loop, deep-canvas-cells, deep-canvas-effects, deep-canvas-scene3d, deep-effects-render, deep-scene3d-render, deep-marks-render, deep-marks-gpui, deep-marks-vello, deep-text-gpui, deep-text-render (each `Cargo.toml:7` or `:8`); absent in the other 22, deep-hook, deep-relay and deep-contracts among them
- evidence: `rg -n '^rust-version' crates/*/Cargo.toml` → 17 lines, all `1.95`. `rg -n 'rust-version|1\.95' scripts docs/technical-design.md` → nothing reads or explains it. Every build goes through the pinned toolchain, so the field is never the binding limit.
- fix: owner's call: delete the 17 lines (the toolchain file is the one source), or set one value in a `[workspace.package]` and inherit it. Not applied by hand without that call.
- verify: `cargo metadata` (not run).
- risk: none to behavior.

Nits (workspace):
- `crates/deep-gpu-layer/Cargo.toml:72` asks for `sha2 = "0.11"`; the other ten workspace crates that hash ask for `"0.10"` (`rg -n '^sha2' crates/*/Cargo.toml`). Both versions are in the lock for upstream reasons too, so aligning it saves nothing at build; it is only two APIs for one job.
- `serde_json` is declared three ways across crates (plain, `preserve_order`, `preserve_order` + `float_roundtrip`). Feature unification gives every workspace build all of them; a crate that declares it plain and relies on key order (deep-app, deep-replica, deep-panel-host) gets that order only because a canvas crate it depends on asks for it.

---

## deep-app

Read in full: `Cargo.toml`, `README.md`, `src/lib.rs`, `hub.rs`, `record.rs`, `events.rs` (non-test), `installed.rs`, `panel_module.rs`, `answer.rs`, `trusted_input.rs`, `confirm.rs`, `states.rs:1-560`. The rest of the crate was checked by scripts only (features, targets, `pub` items, allows, old names); see the coverage table.

### RUST-APP-13  The app's Needs you list drifts from the hub's inbox: an ask shown again after Later stays "later", and any writer's `ask.later` puts a row in Later
- kind: broken (state that drifts between the hub and the app; it lasts until the hub restarts, since the inbox is re-read only for a new start ID)
- confidence: SURE for the mismatch (both sides read); nothing was run
- where: `crates/deep-app/src/record.rs:155-217` (`View::apply`), `:354-365` (the inbox is read again only when `start != self.view.start`); the core it copies: `packages/record/src/projections.ts:364-385`, `packages/asks/src/index.ts:1984-2008`; readers of the app's copy: `crates/deep-app/src/views.rs:733-747, 1258-1261`, `src/lib.rs:186-235` (`deepbuild.needs_you`, what every panel reads)
- evidence: the app's copy handles four things: `ask.created`, `ask.later`, the closing kinds, and the core's `default.undone`.
  ```rust
  } else if kind == "ask.later" {
      for row in self.inbox.iter_mut().filter(|row| row["ask"] == event["subject"] && row["status"] != "closed") {
          row["status"] = json!("later");
      }
  ```
  The core takes an `ask.later` only from the core (`if (e.writer !== 'core') break;`, "an app's or the CLI's own event changes nothing") and only with an `until` before the deadline, and it ends Later on the core's `ask.batched` ("Shown again: an ask hidden by Later is back to open": `status = CASE status WHEN 'later' THEN 'open'`, and `delete ask.later` in the asks core). `rg -n 'ask\.batched' crates/deep-app/src`: only `kinds.rs` and tests read it, for the batch's members; `View::apply` has no arm for it.
- failure: (1) you press Later on an ask; when its time is up the core records `ask.batched` and the hub's `inbox.read` lists it `shown` again; the running app keeps the row `later`, so Needs you draws it dimmed (`views.rs:1260`) and every panel's `needs_you().later` still names it, until the hub is restarted. (2) an `ask.later` the core did not write (the projection's own comment allows for one) changes nothing in the hub and moves the row to Later in the app.
- fix: in `View::apply`, old:
  ```rust
          } else if kind == "ask.later" {
  ```
  new:
  ```rust
          } else if kind == "ask.batched" && event["writer"] == "core" {
              // Shown again: an ask Later hid is back, as in the core.
              for item in event["data"]["asks"].as_array().into_iter().flatten() {
                  let named = item["ask"].as_str().unwrap_or_default();
                  let ask = if named.starts_with("ask:") { named.to_owned() } else { format!("ask:{named}") };
                  for row in self.inbox.iter_mut().filter(|row| row["ask"] == ask.as_str() && row["status"] == "later") {
                      row["status"] = json!("shown");
                  }
              }
          } else if kind == "ask.later" && event["writer"] == "core" {
  ```
  This still leaves the core's `until < deadline` and actor/scope conditions, `queued`/`held`, and a fold that ends when its exception closes unmodelled: the app keeps a partial copy of a projection the hub already serves. The lasting fix is to read the inbox again (`inbox.read`) when an event about an ask arrives, instead of folding a second copy.
- verify: a test beside `the_inbox_closes_an_ask_as_the_core_does` (record.rs:682): apply `ask.created`, a core `ask.later`, a core `ask.batched` naming it; the row must read `shown`. And an `ask.later` with `"writer": "cli"` must leave it `shown`. Both fail today.
- risk: `tests/acceptance/34` and `/1141` drive `View`; neither names `ask.batched` or a non-core `ask.later` (`rg -n 'ask\.batched|ask\.later' tests/acceptance/34 tests/acceptance/1141` → nothing), so no test pins the current reading.

### RUST-APP-14  Two installed packages with a view of the same name share one folder in the app: the second replaces the first's files, and the first's ⌘K pages then run the second's script
- kind: broken
- confidence: LIKELY (the overwrite is certain from the code; what gpui-shell does with the already mounted first view was not traced)
- where: `crates/deep-app/src/installed.rs:76-79` (`copy_of`), `:56-60` (`copy_folder` removes the target first), `:110-133` (`load`); `crates/deep-app/src/lib.rs:369-386` (`mount_page` loads `dir/main.js` again); `packages/extension-host/src/host.ts:2926-2931` (`viewRefusal` checks the name's shape only), `:1640-1645` (`installedViews` lists every package's views)
- evidence: `fn copy_of(name: &str) -> PathBuf { crate::hub::root().join("app").join("panels").join(name) }` keys the copy by the view's name alone. `copy_folder` starts with `if to.exists() { std::fs::remove_dir_all(to)?; }`. `View::from_json(dir, view)` keeps that `dir` for the view's pages, and `mount_page(&runtime, panel, &page, …)` loads `panel/main.js` when a page is opened. The host refuses a second registration of an environment, adapter, channel, state source, source or schedule by another package ("is already registered by …", host.ts:2560-2665, 2858); `deep.registerView` has no such check, and the view name is only held to `/^[a-z][a-z0-9_.-]*$/`.
- failure: packages A and B each register a view `status`. `load` copies A's panel to `~/.deepbuild/app/panels/status` and mounts it, then deletes that folder, copies B's panel there and mounts it. A's ⌘K page entries point at the same folder, so opening one runs B's `main.js` with A's page params, under A's name.
- fix: key the copy by its package too. In `load`, old: `let dir = copy_of(name);` new:
  ```rust
          // Two packages may each have a view of one name: each copy is its package's own.
          let owner: String = view["extension"].as_str().unwrap_or_default().chars()
              .map(|c| if c.is_ascii_alphanumeric() || "._-".contains(c) { c } else { '_' }).collect();
          let dir = copy_of(&format!("{owner}--{name}"));
  ```
  (`extension` is in every row `installedViews` returns.) The hub side wants the same "already registered by" refusal the other slots have; that is the extension-host reader's file.
- verify: `tests/acceptance/1454` mounts installed views; a case with two packages registering one view name, asserting both folders exist under `app/panels/`. `rg -n 'app.{1,6}panels|copy_of' crates packages scripts tests docs/technical-design.md` finds no other reader of that folder's layout.
- risk: an old `app/panels/<name>` copy is left behind once (it is rewritten on every load anyway).

### RUST-APP-15  The panel import check misses a toolkit import written as a template literal, as a computed string, or after a regex literal that holds a quote
- kind: broken (a check that passes without seeing what it checks)
- confidence: LIKELY (the scanner's behavior is certain from the code; whether gpui-shell's runtime resolves a dynamic `import()` was not run; the scanner itself handles `import("…")`, so its author expected it to)
- where: `crates/deep-app/src/panel_module.rs:163-190` (`check`), `:257-291` (`imports`), `:306-354` (`blank`)
- evidence: `blank` records a string literal only when it is not a template: `if quote != b'`' && at < bytes.len() { strings.push((start, end)); }`. `check` refuses only an exact specifier: `if TOOLKIT.contains(&specifier)`. `blank` has no notion of a regex literal, so a `"` inside one opens a "string" that runs to the next quote.
- failure: each of these passes `panel_module::check` (so `panel@1` at pack check and `admit` at load), though the module doc says it "refuses a panel that imports a toolkit module":
  - ``const kit = await import(`gpui-kit`);`` (no string recorded);
  - `const kit = await import("gpui-" + "kit");` (the specifier read is `gpui-`);
  - `const q = /"/; import { Chart } from "gpui-kit";` (the scanner pairs the regex's quote with the import's opening quote, so the specifier it sees is `/; import { Chart } from `).
  The policy stays empty either way (no network, files or storage); what gets through is the toolkit's off-catalog components, the per-frame ones the catalog withholds among them.
- fix: record a template literal that holds no `${` as a string (`if at < bytes.len() && (quote != b'`' || !source[start..end].contains("${"))`), and in `check` refuse a call import (`names == None` from `import(`/`require(`) whose literal is not followed by `)`: a specifier the line computes can't be read, so it is not allowed. The regex case needs the scanner to know where an expression can start; refusing a panel whose blanked code still holds a `"`, `'` or backtick is the cheap sound version.
- verify: extend `imports_are_read_with_their_lines_and_names` (panel_module.rs:397) with the three lines above; `tests/acceptance/1425/imports.test.ts` covers the plain spellings only (`rg -n 'import\(`' tests/acceptance/1425` → nothing).
- risk: a panel that builds a specifier at run time for its own files (`import("./pages/" + name + ".js")`) would be refused; none of the twelve shipped panels does.

### RUST-APP-16  "The kinds that close an ask" is written three times in the crate, and the fixture's copy disagrees with the other two
- kind: inconsistent
- confidence: SURE (the three lists); LIKELY for the effect (a fixture with such an event was not found)
- where: `crates/deep-app/src/record.rs:30-38` (7 kinds, with outcomes), `crates/deep-app/src/states.rs:178-186` (the same 7), `crates/deep-app/src/events.rs:14-21` (6: no `decision.applied`), and the close rule itself: `states.rs:195-206` (`closes`: not from `hook` or `mcp:*`) against `events.rs:173-175` (any writer)
- evidence: `events.rs` (the `fixtures` feature's inbox, which deep-replica's kit reads as the expected list: `crates/deep-replica/src/kit.rs:51` `let expected = state.inbox.rows();`) closes an ask on `CLOSING.contains(&kind) && ask.closed.is_none()` whoever wrote the event and never on `decision.applied`; `record.rs`, which feeds the panel under test (`needs_you`), closes through `states::closes`.
- failure: a kit fixture holding an agent's `ask.cancelled` (writer `mcp:…`) or a `decision.applied`: the expected rows and the rows a correct panel shows differ by that ask, so `needs-you@1` fails a correct panel (or passes one that hides the ask).
- fix: make `events.rs` read the one rule: replace its `CLOSING` test with `crate::states::closes(event, &ask.handle)` (it handles `decision.applied`'s `data.ask` too, so the `subject` lookup above it must also try `event["data"]["ask"]`), and have `record.rs` take its kinds from `states::CLOSING` (made `pub(crate)`) with only the outcome words beside them.
- verify: `crates/deep-app/src/events.rs` tests plus `tests/acceptance/338`; a fixture line with `"writer":"mcp:agent"` on an `ask.cancelled`.
- risk: `tests/acceptance/338`'s fixtures were written against `events.rs` as it is; if one holds an agent-written close, that suite pins the present reading: then this is a QUESTION for the blind redraft.

Nits (deep-app):
- `src/table/view.rs:118` `Table::with_rich` is the only way to set a rich-cell builder and nothing calls it (the one `pub` name in the area that appears once in the whole checkout, by a script over `crates tests scripts packages benchmarks docs`); with it unset, `view.rs:491-493` never builds a rich cell. #1477's table has no shipped caller yet, so it may be meant for one.
- `src/hub.rs:19-29` reads `hub.address` only; deep-hook's `address()` also honors `hub.use` (a worktree sent to a dev hub, `crates/deep-hook/src/main.rs:117-143`). The app is not started from a worktree, so this is by design; noted because the two are described as "the one setting every client reads".
- `src/installed.rs:102`: a listed view with no `name` gives `copy_of("")`, the panels folder itself, which `copy_folder` then removes whole. The hub never lists one without a name.

---

## deep-replica

Read in full: `Cargo.toml`, `README.md`, `src/lib.rs`, `src/main.rs:1-135`, `src/kit.rs:1-330`; the claim logic of `src/drive/check.rs` (40-135, 488-572), `drive/frames.rs` (30-56) and `drive/motion.rs` (596-632, 728-802). The rest was checked by scripts only. The drive checks read as careful about invariant 2: `ui_check` answers INCONCLUSIVE for no view, an uncovered file or a promise with no base (`check.rs:121-128`); the frame report for no clean step (`frames.rs:47-51`); a recording that ends before its last input's 2 s (`motion.rs:617-629`). Every `[[bin]]` and `[[test]]` path in the three manifests that have them exists (script over `path = "…"`), and each of the five binaries has a caller in `scripts/` or `tests/acceptance`. The crate's two features both have `cfg` uses and outside users.

No full finding from what I read. RUST-APP-16 above is the one place I found the replica and the app reading one thing two ways (`kit.rs:51` takes its expected rows from `events.rs`; the panel under test reads `record.rs`).

Nits and questions (deep-replica):
- QUESTION, invariant 2: `drive/check.rs:500-566` `journey`: a journey that is only its `launch` audits no screen (the audits run after each later call), and if `close` reports `outcome: "passed"` with no steps, `steps.len() == 0` equals the journey's step count and the claim is PASS with nothing looked at. I did not trace what `close` answers for no steps (`drive/mod.rs:1445-1458`).
- QUESTION, invariant 2: `kit.rs:260-297` `states(row, seen)` passes for an empty `seen` (no surface was read), and `kit.rs:157-191` `journey_lint` passes for `[]`. Both are surfaces `tests/acceptance/326` and `/1459` name, so a change goes through a redraft.
- `README.md:5` lists four binaries; `Cargo.toml:59-61` has a fifth, `deep-plain-words` (#1348, the `plain words` lane in `scripts/lanes.mjs:316`). Its test list names tests/acceptance 326 and 327 only; the manifest also builds 883, 992, 994 and 1425.
- `src/lib.rs:64-66` `repo_root()` and `drive/check.rs:56` bake `CARGO_MANIFEST_DIR` in, so the kits read their fixture (`docs/spikes/338/fixtures/needs-you.events.jsonl`) from the checkout the binary was built in. `packages/hub/src/panels.ts:17` looks for the binary under that same checkout's `target/debug`, so the two agree today; a replica built for a release would not find its fixture and `load_state` would panic on `.expect("the fixture record parses")`. Same pattern in `crates/deep-app/src/setup.rs:209`: with no `deep` on the login shell's PATH, Set up runs `node <the build machine's checkout>/packages/cli/dist/main.js`, and on any other machine reports node's "Cannot find module" with that path rather than that `deep` is not installed.

---

## What the prior reports cover, and PR #2051

Read `prior/reports/hillclimb-audit-2026-11-09/05-rust-runtime.md` (headings, intro, dispositions) and `10-app-show.md` (headings, intro, dispositions) and the PR's whole diff for `crates/deep-hook` (`heavy.rs`, `main.rs`, `matcher.rs`). Nothing above repeats them. Against the PR: RUST-APP-2's edit is inside `creates_cloud`, which the PR does not touch; RUST-APP-1 touches `shell.rs`, which the PR does not change; RUST-APP-3 is in `remote.rs`, unchanged by the PR; RUST-APP-4 is in `main.rs`'s `cloud_owner`/`covered`, outside the PR's three hunks there (`heavy_call`, `exchange`'s `sent`, `forward`'s `payload`).

---

## Coverage

| Crate | Read in full | Skimmed or read in part | Not read, and why |
| --- | --- | --- | --- |
| deep-hook | `src/main.rs`, `matcher.rs:1-1900` (all non-test code), `shell.rs` (all), `heavy.rs`, `inline.rs`, `actions.rs`, `remote.rs`, `lib.rs`, `heavy.json`, `Cargo.toml`, `README.md` | `default-rules.json` (entries listed by script: name, fail_closed, mode, match; `proofs` not read), `tests/cli.rs` and `tests/busy_disk.rs` (test names only), `matcher.rs:1900-2508` (tests: first cases only) | `src/actions.json` (data written by `scripts/actions-server.mjs`) |
| deep-relay | every file (`relay.rs`, `macos.rs`, `suite.rs`, `wire.rs`, both bins, `lib.rs`, `Cargo.toml`, `README.md`) | | |
| deep-panel-host | every file | | |
| deep-contracts | `Cargo.toml`, `README.md`, `src/main.rs`; the generator's entry `packages/contracts/src/generate.ts` | `src/generated.rs` (head, tail, its `roundtrip` arms against the schema files) | `src/lib.rs` and `tests/jcs.rs` (changed by PR #2051 and covered by 05-rust-runtime F4; I ran out of room before them), `packages/contracts/src/codegen-rust.ts` (the generator's body) |
| workspace | `Cargo.toml`, `.cargo/config.toml`, `rust-toolchain.toml`, `lean-toolchain` | `Cargo.lock` (parsed by script: duplicates, dependents, profile names) | |
| deep-app | `Cargo.toml`, `README.md`, `src/lib.rs`, `hub.rs`, `record.rs`, `installed.rs`, `panel_module.rs`, `answer.rs`, `trusted_input.rs`, `confirm.rs` | `events.rs:1-240`, `states.rs:1-560`, `setup.rs:150-275`, `views.rs` (three excerpts), `main.rs:436-462`, `table/view.rs:100-135` | Everything else, about 17,000 lines: `question.rs`, `card.rs`, `arming.rs`, `bound.rs`, `notify.rs`, `views.rs`, `main.rs`, `commands.rs`, `show.rs`, `shown.rs`, `single.rs`, `plain.rs`, `rules.rs`, `text.rs`, `color.rs`, `brand.rs`, `kinds.rs`, `panel_check.rs`, `panel_keys.rs`, `panel_tree.rs`, `panel_values.rs`, `chrome*.rs`, `canvas.rs`, `capture.rs`, `cells.rs`, `device.rs`, `devices.rs`, `gpu_view.rs`, `spike.rs`, `probes/`, `table/` (but the excerpt), `lists_1477.rs`, `screens.rs`, `spike_402.rs`, `panels/*/main.js`, `panel-menu.js`, `panel-catalog.json`, `inventory.json`, `tests/`. Reason: one reader's room. I planned three sub-readers for deep-app and deep-replica; the session was at its subagent cap and they were refused. Script checks did cover the whole crate: each Cargo feature has `cfg` uses and outside users; every target path exists; no `#[allow(dead_code)]`; one `pub` name with no user (`with_rich`); no `doneright` name. |
| deep-replica | `Cargo.toml`, `README.md`, `src/lib.rs` | `src/main.rs:1-135`, `src/kit.rs:1-330`, the claim logic in `drive/check.rs`, `drive/frames.rs`, `drive/motion.rs` | About 9,000 lines: `replica.rs`, `live.rs`, `snapshot.rs`, `shell.rs`, `terminal.rs`, `canvas.rs`, `chrome.rs`, `plain_words.rs`, `deep_drive.rs`, `drive/mod.rs`, `drive/locate.rs`, `drive/glyphs.rs`, `drive/plant.rs`, the rest of `drive/check.rs` and `drive/motion.rs`, `headless.rs`, `card_size.rs`, `tests/`, fixtures. Same reason. The same script checks covered it. |

Not looked for at all in the unread files: the question card's arming and answer path end to end, UI state that is never cleared, the capture and device permission paths, sockets and children in `live.rs`/`terminal.rs`/`canvas.rs`, and the panels' JavaScript against the host functions. Those want a second pass.
