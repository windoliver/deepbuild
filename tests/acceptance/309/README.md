# Acceptance tests for #309: relay@1, the shipped relay and the network seam's macOS backend

Written first, from issue #309 ("Relay protocol relay@1: the shipped relay and the macOS network backend, which the net
module and game.online both speak": its scope, its Fields and "It can never" list, its 5 acceptance criteria and its
proof line), its oracle page, the design sections it links and those they lean on, and base commit `c9225aa3` ("Merge
pull request #976 …"), by a job that never saw an implementation; none existed. The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

The oracle page maps no upstream test to any of the five criteria (relay@1, its hello and digest, its frame layout, the
relay suite and the fault list are our own protocol; criterion 5 is our own rule), so nothing upstream is ported here;
these tests are the local proof for all five.

What was read:

- `docs/technical-design.md`: Relay and Join, Relay protocol (1853–1863: "a copy refuses a relay that answers another
  protocol or digest before sending any entry"; the hello's limits; "the relay DeepBuild ships"; the interop part), How
  we know version 0 works (conformance kits, planted fakes, Criteria in a checked shape: tests reach their observable
  through a surface the issue names; Wrong programs: a test proves a criterion only if it fails on the planted twin
  the criterion names), Dogfooding, Tests written first.
- `docs/canvas-primitives.md`: Seam and backend (1201: the network seam "carries a match's messages over https to the
  relay a piece declares … its suite needs every message delivered once and in order through a test relay that
  delays, drops, duplicates and reorders, with nothing sent before Join or to another host"; the interop part), Shared
  play over a relay (6876), Net `net@1` (the repeat rule, `timeout: s = 5`), Net: relay and Join (6998: "The relay is
  yours … DeepBuild runs no service"), Net: relay protocol `relay@1` (7018: its Fields, hello limits, `join`'s `open`
  and refusals, `closed`, "a relay that names another protocol or digest is refused before any entry is sent, naming
  the relay host and the digest it gave", the relay suite's checks), Check input: net kinds (net.rollback runs "over a
  test relay, with no network").
- At the base: AGENTS.md; `tests/acceptance/140/platform/` (README, BASE-FAILURE.txt, helpers.ts, network.test.ts,
  tsconfig.json), whose structure and conventions these files follow; `crates/deep-canvas-seams/src/network.rs` (the
  network seam's `Transport` and `Wire`, its correct test backend `network.test`, its suite and its local test relay
  `relay.test`); `crates/deep-show/src/seams.rs` and `main.rs` (the `seam_suite` call, the startup `--planted`);
  `scripts/lanes.mjs`, `scripts/seams.mjs`, `scripts/canvas-kit.mjs`, `scripts/contract-diff.mjs`, `contracts/`,
  `packages/contracts/` (`digests.json`, `schemas/`, `slots/`, `d1Digest`).

What the base already does and these tests don't credit: #140's network seam (its `Transport`/`Wire` interface, the
correct test backend `network.test`, the suite and its in-process test relay) and `deep-show run`'s `seam_suite` call
with its four planted test backends; `scripts/seams.mjs` (the lane `seams`). There is no relay protocol contract, no
`relay@1` digest in `packages/contracts/digests.json`, no relay program, no relay suite, no macOS network backend, no
`relay_client` call and no lane `relay`.

## Run them

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/309 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/309/tsconfig.json   # type-check
```

Each file first builds what it uses, once (`cargo build --locked --bin deep-show`, and `cargo build --locked --bin
deep-relay --bin deep-relay-suite` apart from it), copies each binary out of `target/debug` under its own name into a
temporary folder, and fails each test that uses a binary that didn't build. Each file makes a throwaway certificate
authority and a relay certificate for IP 127.0.0.1 with the `openssl` CLI in a temporary folder, checks the pair with
a TLS handshake of its own, and deletes it after; nothing is installed in a keychain and no secret is committed. Every
relay runs on 127.0.0.1 at a port it picks; nothing reaches another host, the internet, SSH or a paid service. Every
process a test starts is stopped by its own PID. The tests use node built-ins, the `openssl` CLI (macOS's LibreSSL or
Homebrew's OpenSSL both work) and vitest only. A run with `--root` may leave Vitest's cache in
`tests/acceptance/309/node_modules/.vite`; delete it.

`scripts/lanes.mjs` needs, and this README is the instruction (the implementer makes these edits):

- `tests/acceptance/309/` in `alone`, the unit lane's one-at-a-time list, since the files build cargo binaries and
  start relays;
- a lane `{ name: 'relay', commands: [[process.execPath, 'scripts/relay-kit.mjs']] }` in `checks` (criterion 1's "in
  the local preflight" and criterion 5's kit).

`BASE-FAILURE.txt` is the run at the base.

## The surface under test

The issue names relay@1 with a committed digest, the shipped relay, the relay suite and its reader, the network seam's
macOS backend, test clients on it, the network seam's suite (#140) and its local test relay, Join, an interop run and
the kit, but no command. So these tests extend what exists (`deep-show run`'s calls and startup `--planted`, #140's
`seam_suite`, `scripts/lanes.mjs`, `packages/contracts/digests.json`) and add one crate's two binaries and one script.
Everything below is the smallest set the criteria need; how relay@1 rides on https (the framing of its messages) is
the implementer's and the contract's, and no test reads it.

### relay@1's committed digest (criterion 1)

- relay@1's contract file is `packages/contracts/schemas/relay@1.json` or `packages/contracts/slots/relay@1.json`, and
  its frozen digest is the entry `"relay@1"` in `packages/contracts/digests.json`, equal to `d1Digest` of that file
  (the contracts package's public entry), as every frozen contract's is.
- The frame's documented little-endian layout, as the tests read it (the issue's Fields): bytes 0–15 `match`, byte 16
  `player` (u8), 17–20 `confirmed` (u32 LE), 21–24 `first` (u32 LE), 25–26 `count` (u16 LE), then each step's entries.
  Every frame in every reply below is these bytes, as lowercase hex.

### `deep-relay`: the shipped relay (criteria 1, 2, 3, 5)

A binary `deep-relay` in a new workspace crate (`crates/deep-relay` is the obvious home), built by `cargo build --locked
--bin deep-relay`:

```sh
deep-relay --listen 127.0.0.1:0 --cert <relay.pem> --key <relay.key> [--planted <name>]
```

- It serves relay@1 over https on the address given (port 0: one it picks) with that certificate and PKCS#8 key, and
  once it accepts connections prints one stdout line `{"listening": "127.0.0.1:<port>", …}` (other members aren't
  read). It runs until stopped by its PID (SIGTERM).
- Its hello is `{protocol: "relay@1", digest: <the committed digest>}`, with the limits the design gives it.
- Planted twins, each reachable only through `--planted` and otherwise the shipped relay:
  - `forwards_to_other_match`: it forwards one frame of a match to the copies of another match it holds.
  - `hello_other_protocol`: its hello names the protocol `relay@2` (with the committed digest).
  - `hello_other_digest`: its hello names `relay@1` with the digest
    `d1:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef`.
  - With any `--planted`, it also prints one stdout line per relay@1 message it receives:
    `{"conn": n, "received": "join" | "forward" | "signal" | <another relay@1 message's name>, "bytes": "<hex>"}`
    (`bytes`: the frame for a `forward`). The shipped relay prints no such line: it keeps nothing.

### `deep-relay-suite`: the relay suite (criterion 1)

A binary `deep-relay-suite` in the same crate:

```sh
deep-relay-suite --relay https://127.0.0.1:<port> --ca <ca.pem>
```

`--ca`: a PEM certificate authority the suite trusts for this run. It plays the relay suite against the relay
(joining, forwarding only within a match, keeping nothing once a match ends; the design's refusals and limits may join
them), with at least two matches open at once and at least two copies in each, and one join with `open` false to a
match it played and ended. It exits 0 on PASS and non-zero on FAIL, and its last stdout line is:

```json
{"suite": "relay@1", "relay": "127.0.0.1:<port>", "hello": {"protocol": string, "digest": string},
 "status": "PASS" | "FAIL",
 "checks": {"joining" | "forwarding" | "keeps_nothing" | <more>: {"status": "PASS" | "FAIL", "failures": [string]}},
 "connections": [{"match": "<32 hex>", "join": {"player": n} | {"refused": "unknown" | "full" | "started"},
                  "sent": ["<frame hex>"], "received": ["<frame hex>"]}]}
```

`connections` lists every connection the suite opened, in the order opened: the match ID it joined (16 bytes as 32
lowercase hex digits), the relay's answer to its join, every frame it sent and every frame the relay forwarded to it.
A failure that a frame crossed matches names both match IDs, as 32 hex digits.

### `deep-show run`: `relay_client`, a test client on the macOS backend (criteria 2, 3, 5)

```json
{"call": "relay_client", "relay": "https://127.0.0.1:<port>", "ca": "<ca.pem>", "match": "<32 hex>",
 "players": n, "frames": n}
```

One test client on the network seam's macOS backend, named `network.macos` in every reply: it connects over https to
the relay given (the chosen relay, the only host it may reach), trusting `ca` for this run; reads the hello and refuses
a relay that answers another protocol or digest before it sends any frame; joins the match ID with `players` seats,
opening it if no copy has yet (relay@1's `open`: a second opening join of a held match joins it, so clients started
together join in either order); and then sends `frames` frames, frame i (from 0) being `{match, its player,
confirmed, first: i, count: 1, then step i's entries}`, within the hello's limits. It ends once it holds `frames`
frames from every other player, or after net@1's `timeout` (5 s) with nothing arriving once the match started. It
never moves to another relay. Its reply:

```json
{"backend": {"name": "network.macos", "version": string}, "relay": "127.0.0.1:<port>",
 "hello": {"protocol": string, "digest": string} | null,
 "outcome": "exchanged" | "refused" | "failed", "reason": string | null,
 "match": "<32 hex>", "player": n | null,
 "sent": ["<frame hex>"], "received": ["<frame hex>"],
 "reader": {"status": "PASS" | "FAIL", "failures": [string]}}
```

- `hello`: what the relay's hello answered, null when none arrived. `outcome`: `exchanged` when it joined, sent its
  frames and held every other player's; `refused` when the hello check refused the relay; `failed` for anything else
  (the relay unreachable or gone, a join refused, a timeout). `reason`, for `refused` and `failed`: why, naming the
  relay host as `127.0.0.1:<port>`, and for a refused hello what it answered (the protocol, or the digest).
- `sent`: every frame it sent, in order; `received`: every frame the relay forwarded to it, in arrival order.
- `reader`: the relay suite's reader's verdict on every frame received, each read in relay@1's little-endian layout.
  A failure names the field and the client as `player <n>`, its player number in the match. relay@1's repeat rule
  (each frame repeats its copy's messages after the lowest step its peers confirmed) means a copy's frames leave no gap
  between one frame's steps and the next one's, which is one way the reader can see a field written in the wrong
  byte order.
- Planted twins, through `deep-show run --planted <name>`:
  - `net_skips_hello_check`: the macOS backend without the hello check; it joins and sends its frames whatever the
    hello said.
  - `net_writes_step_big_endian`: the macOS backend writing each frame's `first` big-endian.

### `deep-show run`: `seam_suite` on the macOS backend (criterion 4)

#140's call with one member more:

```json
{"call": "seam_suite", "seam": "network", "backend": "network.macos", "messages": 10000, "seed": n}
```

`backend` names which of the build's network backends the suite runs: `network.macos`, the macOS backend, through the
network seam's local test relay (#140), which delays, drops, duplicates and reorders the messages by the seed. Without
`backend` the call stays #140's, on the test backend. The reply is #140's (`seam`, `suite`, `backend`, `status`,
`faults`, `relay` counts, `hosts`, `sent_before_join`, `sent`, `delivered`), with `backend.name` `network.macos`.
`deep-show run --planted net_macos_delivers_twice` runs a planted macOS backend (its name starting `network.macos`)
that hands one message on twice.

### `scripts/relay-kit.mjs`: the kit (criteria 1 and 5), the lane `relay`

```sh
node scripts/relay-kit.mjs [--planted interop_shipped_only]
```

It starts the shipped relay locally (with a throwaway certificate of its own) and runs the relay suite on it, and runs
the interop run against every relay implementation the repo holds (the shipped relay, named `deep-relay`, and each
other; the network seam's local test relay is one, if it carries relay@1 frames), and fails when a protocol change's
interop run left an implementation out. Its last stdout line:

```json
{"relay_kit": {"status": "PASS" | "FAIL", "suite": "PASS" | "FAIL", "protocol_changed": bool,
               "implementations": [string], "interop": [string], "left_out": [string]}}
```

`suite`: the relay suite's verdict on the shipped relay; `implementations`: every relay implementation, by name;
`interop`: the ones the interop run covered; `left_out`: the implementations a protocol change's interop run missed.
On FAIL it prints a line starting `FAIL` naming each relay left out, and exits non-zero; on PASS it exits 0.
`--planted interop_shipped_only`: a protocol change (relay@1's shape changed in a scratch copy, never in the checkout)
whose interop run covers only `deep-relay`.

### Planted programs

| Selected by | The wrong program | Criterion |
|---|---|---|
| `deep-relay --planted forwards_to_other_match` | a relay that forwards one frame to another match's copies | 1 (issue-named) |
| `deep-relay --planted hello_other_protocol` | a relay whose hello names another protocol, `relay@2` | 2 (issue-named fixture) |
| `deep-relay --planted hello_other_digest` | a relay whose hello names relay@1 with another digest | 2 (issue-named fixture) |
| `deep-show run --planted net_skips_hello_check` | a macOS backend that skips the hello check | 2 (issue-named) |
| `deep-show run --planted net_writes_step_big_endian` | a client that writes a frame's step (`first`) big-endian | 3 (issue-named) |
| `deep-show run --planted net_macos_delivers_twice` | a macOS backend that delivers a message twice | 4 (issue-named) |
| `node scripts/relay-kit.mjs --planted interop_shipped_only` | a protocol change whose interop run covers only the shipped relay | 5 (issue-named) |

## Criteria to tests

Each test's name starts with `#309.<n>`, the criterion's number in the issue.

| # | Criterion (the issue's text, shortened) | Tests and what each asserts | Surface |
|---|---|---|---|
| 1 | The shipped relay answers relay@1 with the committed digest and passes the relay suite; a planted relay that forwards one frame to another match's copies fails it, naming both match IDs | `relay-suite.test.ts`: `digests.json` holds `relay@1`, a d1 digest equal to `d1Digest` of its contract file. The suite on `deep-relay`: hello `relay@1` with that digest; `joining`, `forwarding`, `keeps_nothing` PASS; this file reads every frame each connection sent and received (match in its first 16 bytes): none crossed matches, none came back to its sender, each was sent by another copy of the match; at least two matches with two receiving copies each; a join to a played match refused `unknown`; PASS, exit 0. The lane `relay` runs `scripts/relay-kit.mjs`, which exits 0 with `suite` PASS. The planted relay: this file finds a frame of match A among match B's received frames, a suite failure names both A and B, FAIL, non-zero exit | `deep-relay`, `deep-relay-suite`, digests.json, lanes.mjs, `scripts/relay-kit.mjs` |
| 2 | Through the macOS backend, a test client refuses a relay answering another protocol's hello, and one answering relay@1 with another digest, before sending any frame, naming the host and what it answered; a planted backend that skips the hello check sends a frame to the second and fails, naming the host | `hello.test.ts`: per planted relay, two clients on one match: backend `network.macos`, `hello` as the relay answered, `outcome` refused, `reason` names `127.0.0.1:<port>` and `relay@2` / the other digest, nothing sent; the relay's own record shows no `forward`. The planted backend: the relay's record shows a `forward`; the criterion's check (a frame reached a relay whose hello wasn't relay@1 with the committed digest) fails, naming the host | `deep-relay --planted`, `relay_client`, `--planted net_skips_hello_check` |
| 3 | Two test clients on the macOS backend join one match ID through the shipped relay and exchange 1,200 frames, each read back field by field in relay@1's little-endian layout; a planted client writing a frame's step big-endian fails the relay suite's reader, naming the field and the client | `frames.test.ts`: both `exchanged`, hello relay@1 with the committed digest, different players; each sent 1,200 frames, this file reads each field LE (match, own player, `first` i, `count` 1, `confirmed` never back, never past i+1); each received the other's 1,200 frames byte for byte in order, each field as sent; both readers PASS. The planted client: its frames' `first` read big-endian is each step and little-endian isn't; the correct client's reader FAILs with a failure naming `first` and `player <n>` | `deep-relay`, `relay_client`, `--planted net_writes_step_big_endian` |
| 4 | The macOS backend passes the network seam's suite (#140) through its local test relay, which delays, drops, duplicates and reorders 10,000 messages, so every message arrives once and in order; a planted backend that delivers a message twice fails it, naming the fault | `network-suite.test.ts`: seeds 1, 2, 3 with `backend: network.macos`: the reply names `network.macos`; the relay carried 10,000 and delayed, dropped, duplicated and reordered some; this file's check of `sent` against `delivered` finds each once and in order; nothing before join; no unlisted host; no fault; PASS. The planted backend: a duplicate in `delivered`, FAIL, `faults` has `delivered_twice` and none of the other three | `seam_suite` + `backend`, `--planted net_macos_delivers_twice` |
| 5 | With a second relay deployed, Join keeps using the chosen one until you switch; stopping it fails the Join with its reason and never moves to the other; a protocol change whose interop run covers only the shipped relay fails the kit, naming the relay left out | `chosen-relay.test.ts`: two shipped relays, each behind this file's own TCP pass-through counting connections: two Joins (client pairs) with the chosen relay exchange, the second relay sees no connection; the chosen relay stopped by PID and its port closed, a Join fails with a reason naming its host, sends nothing, and the second relay still sees no connection; given the second relay (the switch), a Join exchanges through it. The kit: the lane `relay` runs `scripts/relay-kit.mjs`; clean, every implementation (`deep-relay` among them) covered, `left_out` empty, PASS, exit 0. Planted: `protocol_changed`, `interop` only `deep-relay`, at least one other implementation, `left_out` equal to the ones missed, a `FAIL` line naming each, FAIL, non-zero exit | `deep-relay`, `relay_client`, lanes.mjs, `scripts/relay-kit.mjs --planted` |

The proof line ("The relay suite's report on the shipped relay and on the planted relay, the macOS backend's hello
refusals, the frames read back field by field, and the network seam's suite report on the macOS backend") is these
files' evidence: the suite's two reports with their connections' frames, the two refusals and the planted relay
record, the 2 × 1,200 frames read here, and the three seam-suite reports.

## Readings where the issue and design leave a choice

- **The digest committed in the repo** (1) is read as every frozen contract's is here: an entry in
  `packages/contracts/digests.json`, the d1 digest of relay@1's contract file, so "changing under its digest" fails
  the contract test. The design says relay@1's digest is first committed when it ships; this task ships it.
- **"Passes the relay suite"** (1) names the issue's three checks, and the scope's "in the local preflight" is the lane
  `relay`. The suite's verdict isn't taken alone: the report carries every frame each connection sent and received,
  and this file reads them. "Keeping nothing once a match ends" is read as the design's `unknown` refusal of a join to
  an ended match; the suite's own `keeps_nothing` check may look further.
- **The two hello fixtures** (2) are planted twins of the shipped relay rather than relays the test writes, so the
  framing of relay@1 over https stays the implementer's; they print what they receive, so "before it sends any frame"
  is read from the relay's side, not the client's. "Frame" is relay@1's `forward`; a client may send what the hello
  exchange itself needs (the issue's "before it sends any frame"; the design's "before any entry is sent").
- **"Fails, naming the host"** for the planted backend (2) is the criterion's check in `hello.test.ts`: a frame that
  reached a relay whose hello wasn't relay@1 with the committed digest fails it, naming that relay's host. A backend
  that skips its own check can't fail itself.
- **The test clients' frames** (3): the clients aren't the net module (#179), so they send one step a frame, frame i
  with `first` i and `count` 1, which gives each field a value this file knows without the client's word. "A frame's
  step" is `first`. The reader is the relay suite's, run inside each test client on what it received, and names the
  client by its player number, the only name relay@1 gives a copy.
- **"Two test clients join one match ID"** (3, 5): both are started together, so the client opens the match when no
  copy has, as relay@1's `open` allows a second opening join to join; neither waits on the other's start.
- **The macOS backend in the network seam's suite** (4) is chosen per call (`backend`), so #140's test-backend runs
  stay as they are. "Its local test relay" is #140's; whether the macOS backend reaches it in process or over a local
  socket is the implementer's.
- **"With a second relay deployed"** (5) is a second shipped relay running on another local port, reachable by the
  client; "until you switch" is the next Join being given the second relay. Which relay a Join used is counted by this
  file's own pass-throughs. "Stopping the chosen relay" stops its process by PID and closes its port, as a host gone
  offline.
- **The kit** (5) is `scripts/relay-kit.mjs`, the lane `relay`: the issue's "A change to the protocol passes the
  interop suite against every relay implementation in the same change". "The relay left out" needs a second relay
  implementation in the repo; the network seam's local test relay is the one the issue names beside the shipped
  relay, but the test names none but `deep-relay` and requires at least one other.

Not tested here, because the issue leaves them out or to other tasks: the net module's messages, rollback, Join
prompt and checks, the web player's backend and the seam suite's interop part (#179); game.online (#218); the
signaling and direct path, which the scope says the macOS backend makes "where the platform allows one" and no
criterion measures; the hello's limits, `closed` and the design's join refusals beyond `unknown`, which the relay suite
may add to its checks.
