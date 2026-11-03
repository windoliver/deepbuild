# Acceptance tests for #1106: credential stand-ins, with the supervisor's egress filter putting the value into requests to the credential's own hosts

Written first, blind, on November 2, 2026, from issue #1106 (its text as of that day: Scope, the 4 checkbox criteria,
Proof and Depends on), `docs/technical-design.md` (Threats, and what stops each one; Evidence and its Privacy bullets,
redaction by value; Dogfooding; the env-local row; The stack a check runs against; the Grant and Access words for
hosts and the supervisor's egress filter), `AGENTS.md`, the acceptance suites of #332, #331 and #236 for their
conventions and surfaces, and `packages/supervisor`, `packages/env-local`, `packages/hub` (with `src/plant.ts`) and
`packages/cli` as they are at the base commit `fad1c4cb4e9cc7a782752e595dc6760014d2291e` (main), read for their
public surfaces only, by a job that never saw an implementation of #1106. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

The issue has 4 checkbox criteria, AC1 to AC4 in the body's order.

## How to run

On macOS, with the repo's Node (24.22.0) first on `PATH`:

```sh
npm ci                                            # once, if node_modules is missing
npm run build --workspaces                        # the tests run the built CLI, packages/cli/dist/main.js
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1106 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1106/tsconfig.json
```

- `--no-file-parallelism`: the files start real hubs and stacks on ports leased from 3000 up.
- Nothing leaves the loopback. No Docker, no real account, no real keychain. Each sample API is the test's own HTTPS
  server on 127.0.0.1 (and ::1), with a certificate from a test CA the test makes with `/usr/bin/openssl` for that
  test; every hub is a hub on a temp folder (`deep hub run --root`); every credential is a made-up fake in a dotfile
  under a temp HOME.
- Every test makes its folders under `/tmp/dh1106-*`, points `HOME` at a temp folder for itself and every child,
  removes the agent's own `CLAUDE_*` and `DEEP_*` variables first, and never touches the real `~/.deepbuild`. The
  suite stops only processes it started or whose PID files its fixtures wrote, by PID, after checking the PID still
  runs one of its programs (`helpers.ts`, `cleanup`); never by name or port.
- AC4 never reads or writes the real login keychain or any system trust store. The only keychain it reads is
  `$HOME/Library/Keychains/login.keychain-db` (and `login.keychain`) under the temp HOME, by that explicit path, with
  `security find-certificate -a -Z <path>` and by its bytes; the planted setup must reach only that file.
- With `--root` here, Vitest may write a cache under `tests/acceptance/1106/node_modules/.vite/`; delete it before
  committing.

## The surface under test

The issue and the design name the stand-in ("a random token per run, in the variable the app expects"), the
credential's `hosts:`, its methods, the supervisor's egress filter, a certificate authority made for the run and
trusted only inside the run's sandbox, and refusals "recorded on the run". They give no key for the methods, no way
the app reaches the filter, no event kind for a refusal, and no wording for "by value". These tests define the
smallest surface that reaches every criterion, beside #332's and #331's; each choice is listed here so a dispute can
name it.

### The credential entry (`.deepbuild/done.yaml`), beyond #332's

```yaml
environment:
  up: "<command line>"
  ports: [web]
  ready: { http: "http://127.0.0.1:${web}/health", within: 20 }
  credentials:
    SHOP_API_KEY:  { dotfile: "~/.shop/test.env",  hosts: ["localhost:<port>"], methods: [GET, POST] }
    OTHER_API_KEY: { dotfile: "~/.other/test.env", hosts: ["127.0.0.1:<port>"], methods: [GET] }
```

- **`hosts:`** lists the credential's own hosts, each `<host>:<port>` as a Grant's `hosts` names one (a bare host
  would mean port 443; the tests always give the port, since their sample APIs can't listen on 443). A credential
  with `hosts:` reaches the stack's processes only as a stand-in, in the variable it is declared under, and its hosts
  are hosts the run's egress allows.
- **`methods:`** lists the HTTP methods its value may be put into. The tests send GET and POST to the shop API's host
  and GET to the other's, so every refusal they read is for its placement or its host, never its method.
- The source (`dotfile`) is #332's: the dotfile's `NAME=value` line for the variable's name, named from HOME.

### How the app reaches the filter

The stack's sandbox lets it connect only to granted local ports, so outside HTTPS goes through the filter. The stack's
processes are told where it is, and what to trust, the usual way:

- **`HTTPS_PROXY`** (or `https_proxy`): `http://<host>:<port>` of the egress filter, an HTTP `CONNECT` proxy. A
  `user:password@` in it is sent as `Proxy-Authorization: Basic`, so the filter can tell the run's connections apart.
- **`NODE_EXTRA_CA_CERTS`** or **`SSL_CERT_FILE`**: a PEM bundle holding the run's CA. The app trusts both bundles
  as well as the system's roots.

The app (`fixtures/app.mjs`) `CONNECT`s through the filter to `<host>:<port>`, starts TLS through the tunnel with SNI
for a name (none for an address), and sends one HTTP/1.1 request on it. It puts what it holds in its variable in
`Authorization: Bearer <it>` (a header), `?api_key=<it>` (a query string), or a form body `api_key=<it>` with
`content-type: application/x-www-form-urlencoded` (a body). Each request carries `x-dh1106-attempt: <name>` so the
sample API can tell the test which attempt reached it.

### The sample APIs

- **The sample API's host** (AC1) is `localhost:<port>`, the shop API: the test's HTTPS server on 127.0.0.1 and ::1,
  its certificate for `localhost`, `127.0.0.1` and `::1` from a test CA made for that test. It answers 200 with
  `x-dh1106-upstream: shop` only to `Authorization: Bearer <SHOP_API_KEY's value>`, and 401 to anything else. It
  keeps every request it got.
- **A second allowed host** (AC3) is `127.0.0.1:<port>`, the other API, the same kind of server: the host of a second
  credential, OTHER_API_KEY, so the run's egress allows it. `localhost` and `127.0.0.1` are two distinct hosts that
  resolve without touching `/etc/hosts` or DNS.
- **The hub trusts the test CA** for its upstream connections through `NODE_EXTRA_CA_CERTS=<the test CA's PEM>` in
  the hub process's environment, as Node does by default. The filter, wherever it runs, must trust the hub's
  `NODE_EXTRA_CA_CERTS` for its connections to the credential's hosts.

### Where each criterion reads

- **The stack.** AC1, AC3 and AC4 bring the app up with `deep env up --root <hub> --json` in a worktree (#331's,
  #332's): its `run` is the stack's run. AC2 runs a check through the hub's `run.start` with `environment: true` in a
  plain folder standing for its temporary checkout (#331's): the stack comes up from that folder, and the check is
  `fixtures/journey.mjs`.
- **The process environment** (AC1) is the app's whole environment as its process holds it (`GET /env`).
- **Test output and evidence** (AC2) are the check run's stdout and stderr, which the hub stores as the run's evidence
  under `<hub root>/evidence/` (a packed `.zst` file read unpacked); "a file in its checkout" is `leak.txt`, written by
  the app in the folder it runs in. The reading scans every file under the hub's root, its evidence first, and
  `leak.txt`, for the value raw, in base64, reversed, and XOR'd with `0x5a` (the raw bytes, and their hex in either
  case).
- **Refused** (AC3) is the filter forwarding nothing of the request: neither sample API gets the attempt, and so
  neither gets the value with it.
- **Recorded on the run** (AC3) is read loosely: some event in the record (`events.read`), of any kind but
  `process.*`, `lease.*`, `run.started` and `run.finished`, whose JSON names the stack's run (its `run:<ULID>`), reads
  as a refusal (`refus`, `deny`/`denied`, `block` or `reject`, in its kind or data, as #236's `sandbox.denied` would),
  and names the placement: the second host by its address `127.0.0.1` and its port; the query string by `query` or
  `url`; the body by `body`. Its kind and field names are otherwise the implementer's.
- **The run's CA** (AC4) is the self-signed certificate at the top of what issued the certificate the filter showed
  the app for the shop API's host: found in the chain the app was shown or in the bundles its trust variables name. It
  must not be the sample API's own test CA (the filter terminated TLS with a CA of the run's).
- **Trusted outside the run's sandbox** (AC4) is read over the stores a process outside the sandbox would trust that
  the run could reach: the temp HOME's login keychain (`security find-certificate -a -Z <path>` lists its SHA-1, or
  the file holds its DER or base64); the bundle the hub's own `NODE_EXTRA_CA_CERTS` names; and every other file under
  the temp HOME, `~/.deepbuild` aside. The run's own folders (under the hub's root, or the system temp folder) are
  inside its sandbox and not read. The system trust stores and the real login keychain are not read: a test can't
  reach them safely.

### Planted wrong programs

Selected with the hub's `DEEP_HUB_PLANT` (`packages/hub/src/plant.ts`), as #331's and #332's are; only tests set it.

| `DEEP_HUB_PLANT=` | The wrong program | The criterion's reading must fail, naming |
|---|---|---|
| `standin-value-in-env` | a filter that also puts SHOP_API_KEY's value into the stack's process environment (in any variable) | the variable that holds it |
| `env-loads-by-value` | an environment that loads SHOP_API_KEY by value, as for a credential with no `hosts:` | the evidence file under `<hub root>/evidence/` that holds it |
| `standin-every-host` | a filter that substitutes the value for SHOP_API_KEY's stand-in on a request to any host the run allows | the host, `127.0.0.1:<port>`, that received the value |
| `run-ca-in-login-keychain` | a setup that adds the run's CA to the login keychain: the temp HOME's `$HOME/Library/Keychains/login.keychain-db`, made by the plant if missing, and never the real one, the keychain search list or a system trust store | the store: `the login keychain <path>` |

## Criteria to tests

Each `describe` carries the criterion's ID, `#1106.<first 8 hex of the SHA-256 of its text>` (trimmed, whitespace
collapsed, `- [ ] ` dropped; the command in `tests/acceptance/48/README.md`), and each test's name starts with its
criterion's number. A test headed `(wrong program)` runs the scenario on the plant the criterion names and expects
the criterion's reading, a helper returning the failure message or null, to fail and name the thing.

| ID | Criterion (whole) | Tests: each condition and where it is asserted | At this base |
|---|---|---|---|
| AC1 `#1106.ef63d06f` | A test app sends its stand-in to the sample API's host and gets 200; a planted filter that puts the value into the process environment fails, naming the variable | `standin.test.ts` (2). *Its stand-in*: no variable of the app's process holds the value (raw or base64), and it holds SHOP_API_KEY. *Sends it to the sample API's host and gets 200*: its call through the filter, the stand-in in `Authorization`, gets the shop API's own 200, the API having got the value in that header once and nowhere else. *A planted filter ... fails, naming the variable*: `(wrong program)` on `standin-value-in-env`, the reading's message naming `the variable <NAME>` | fails at `helpers.ts:421` (`mustBeReady`, from `standin.test.ts:43`): `deep env up` is BLOCKED, exit 3, the base refusing a credential entry with `hosts:` (`names one source`). The wrong program fails BLOCKED: `DEEP_HUB_PLANT=standin-value-in-env names no planted program` |
| AC2 `#1106.ef5f04c9` | The app writes its variable reversed and XOR'd into test output and into a file in its checkout, and neither holds the value; a planted environment that loads by value fails, naming the evidence file | `evidence.test.ts` (2). *Writes its variable reversed and XOR'd into test output and into a file in its checkout*: the check passes, its output (with its marker) is in the run's evidence, and `leak.txt` in the checkout holds a reversed copy. *Neither holds the value*: no file under the hub's root and not `leak.txt` holds the value in any form above. *A planted environment that loads by value fails, naming the evidence file*: `(wrong program)` on `env-loads-by-value`, the message naming a file under `<hub root>/evidence/` | fails at `evidence.test.ts:69`: the check finishes `missing`, its stack never came up for the same refusal. The wrong program fails BLOCKED (`env-loads-by-value` names no planted program) |
| AC3 `#1106.bd90f543` | The stand-in sent to a second allowed host, in a query string and in a form body is refused each time and recorded; a filter that substitutes on every allowed host fails, naming the host | `refusals.test.ts` (2). Controls: SHOP_API_KEY's stand-in to its own host, and OTHER_API_KEY's to its own, each get their API's 200. *Sent to a second allowed host*: SHOP_API_KEY's stand-in in `Authorization` to `127.0.0.1:<port>`; *in a query string*, GET to the shop API's host; *in a form body*, POST to it. *Refused each time*: no sample API gets the attempt or the value. *And recorded*: an event names the stack's run, a refusal and the placement. *A filter that substitutes on every allowed host fails, naming the host*: `(wrong program)` on `standin-every-host`, the message naming `127.0.0.1:<port> received SHOP_API_KEY's value` | fails at `helpers.ts:421` (from `refusals.test.ts:71`): `deep env up` BLOCKED, as AC1. The wrong program fails BLOCKED (`standin-every-host`) |
| AC4 `#1106.70f52264` | The run's certificate authority is trusted in no process outside the run's sandbox; a planted setup that adds it to the login keychain fails, naming the store | `ca.test.ts` (2). *The run's certificate authority*: the app's call gets the shop API's 200 through the filter, which showed it a certificate from a self-signed CA the app was given, not the test CA. *Trusted in no process outside the run's sandbox*: the stores above hold it nowhere. *A planted setup that adds it to the login keychain fails, naming the store*: `(wrong program)` on `run-ca-in-login-keychain`, the message naming `the login keychain <path>` | fails at `helpers.ts:421` (from `ca.test.ts:88`): `deep env up` BLOCKED, as AC1. The wrong program fails BLOCKED (`run-ca-in-login-keychain`) |

### Proof

The issue's Proof: "The sample API call with the stand-in, the reversed and XOR'd copies absent from evidence, and the
refused placements, each planted filter shown failing." The four criterion tests are the first three, and AC4; each
`(wrong program)` test shows its plant failing the reading. On the base no plant name exists, so each plant test is
BLOCKED there: the hub refuses to start (`DEEP_HUB_PLANT=<name> names no planted program`).

Every criterion test fails on the base at an assertion (BASE-FAILURE.txt), none on a `toThrow`, but at the same first
condition: the base refuses the `hosts:` key, so no stack comes up. To see the readings fail on a wrong program before
any plant exists, this job also ran, once and uncommitted, the AC2 and AC1 scenarios on the base with `hosts:` and
`methods:` left out, which is loading by value: the journey passed, and its reversed copy of the value was in one file
under `<hub root>/evidence/` (AC2's reading names it); the app's `SHOP_API_KEY` held the value (AC1's reading names
the variable), and its call found no `HTTPS_PROXY`.

### Not tested

- The Scope's fourth bullet, "A credential with no `hosts:` loads by value as today, and its run's record marks it
  `by value`", is in no criterion. The reading this job would use: some event naming the stack's run names the
  credential's variable and the words `by value`. The rest of the Scope's refusals (a stand-in in a routing header,
  or twice in one request) and "a random token per run" are in no criterion either.

## Files

- `helpers.ts`: temp folders and HOME, PID-file cleanup, the test CA and sample APIs, the world (credentials,
  dotfiles, the environment block), a test repo with a worktree and a plain checkout, the hub as a process and its
  line protocol, `deep env up`/`down`, the app's `/env` and `/call`, and file reads (packed evidence unpacked).
- `standin.test.ts` (AC1), `evidence.test.ts` (AC2), `refusals.test.ts` (AC3), `ca.test.ts` (AC4); each holds its
  criterion's reading as a function returning the failure message or null.
- `fixtures/app.mjs` (the repo's app: `/health`, `/env`, `/call` through the filter, `/leak`), `fixtures/journey.mjs`
  (the check that prints the app's reversed and XOR'd copies into its output).
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`; it type-checks clean at the base.
- `BASE-FAILURE.txt`: the run on the base commit.
