# Acceptance tests for #3406: a Claude Code session's own inbox as a delivery route

Drafted blind, before the work, by a job that never saw it. Per AGENTS.md, the implementing agent doesn't edit these files. A dispute goes to a blind redraft by this job.

#3406 is a spike. Its proof is "the report and its corpus entries". So these tests drive nothing: they read what the spike leaves in the repo and check that every finding rests on recorded hook payloads, transcript entries and log lines that show it. An agent's word is never evidence, and nothing unrun passes.

## What this was drafted from

- Issue #3406 as given to this job on November 24: its body and its one comment (the line a script posts: `{"type":"auth","token":"…"}` first when a process outlived its hook, then `{"type":"user","message":{"role":"user","content":"…"}}`).
- The design sections the issue links (What each agent gives us, An ask and your answer getting back, Hooks are evidence, Threats), and in the whole design the budget rule "each side takes 20 samples".
- The epic #6 and the issues #3406 names beside it or depends on: #25, #47, #80, #576, #1105, #2617, #3405.
- The base commit `9e77c2ad6c0ff460dcff6905a161adee490536aa` (`origin/main`), which holds nothing for #3406. Read there, for the surface and never for expected values: `tests/acceptance/80/` and `spikes/80/` (the closest precedent), `tests/acceptance/2175`, `2649`, `3222`, `2435` and their spikes, `adapters/corpus/README.md`, `scripts/corpus.mjs`, `scripts/corpus-redact.mjs`, `tests/acceptance/47/`, `adapters/claude-code.facts.json`, `packages/evidence/`, `scripts/repo-rules.mjs`, `scripts/affected.mjs`, `scripts/lanes.mjs`, `scripts/proof.mjs` and `scripts/proof-runs.mjs`.
- Facts and owner decisions given to this job (November 24): Claude Code on PATH is 2.1.332; the facts cover 2.1.299, 2.1.304 and 2.1.308; the Claude desktop app is 6.28899.6 and bundles 2.1.330; no editor with Claude Code's extension is installed. The terminal and `claude -p` sessions are driven by throwaway scripts, the desktop app sessions are opened by the owner by hand with the throwaway hooks posting and logging, and the editor extension is reported as not run, so its place stays open and the PR says `Part of #3406`.

## How "recording" is read

No screen capture. A recording is what a session's own hooks and transcript hold, redacted: the hook payloads as the throwaway hooks logged them, and entries copied from the session's transcript. It lives in the spike's hook logs, or, for a recording "added to the corpus", in a corpus session (`events.jsonl` and `transcript.jsonl`), which is how #3405 and the corpus use the word.

## The surface (my choice: the issue names only "the report" and "its corpus entries")

One folder, where #2175's, #2649's and #3222's spikes keep their reports, with hook scripts and logs as #80's spike kept them:

```
docs/spikes/3406/
  README.md              the report
  record.json            what the tests read
  hooks/<script>         the throwaway hook scripts (not deep-hook, not the adapter)
  settings/<name>.json   the settings each session ran with, home folders written as ~
  logs/<name>.jsonl      hook logs and copied transcript entries, redacted
adapters/corpus/claude-code/<version>/<session>/   each recording the spike adds to the corpus (#47)
```

Hooks are installed at user level or by `--settings`, never in a repo settings file. The settings files kept here are copies, outside any `.claude/` folder.

### Log lines

Each line of `logs/*.jsonl` is one JSON object. A session's lines are found by its session ID, in whichever log holds them.

| Field | Meaning |
|---|---|
| `at` | epoch milliseconds. On a `start` line, taken as the first thing the hook does. On a `post` line, taken just before the script connects to the inbox. On a `copied` line, the entry's own `timestamp` |
| `place` | `terminal`, `desktop`, `editor` or `headless` (`claude -p`). A line proves things only about its own place |
| `session` | the payload's `session_id` |
| `event` | the hook event (`Stop`, `UserPromptSubmit`, …), or on a `copied` line the entry's `type` |
| `invocation` | on `start`, `post` and `exit`: an ID every line from one hook process shares. A process that outlived its hook keeps its hook's ID |
| `phase` | `start`, `post`, `exit` or `copied`. A line of any other phase is the spike's own: it still holds `at`, `place`, `session` and `event`, and proves nothing here beyond how long the log ran |
| `payload` | on `start`, the hook's stdin JSON; on `copied`, the transcript entry. Both redacted as the corpus recorder redacts (`scripts/corpus-redact.mjs`) |
| `env` | on `start`: `{ "socket", "tokenChars", "fingerprint" }`, what the agent exported to that hook. `socket` is `CLAUDE_CODE_MESSAGING_SOCKET` as given, or `null`. `tokenChars` is how many letters and digits `CLAUDE_CODE_MESSAGING_TOKEN` holds, 0 when it isn't set. `fingerprint` is the SHA-256 (hex) of those letters and digits, in order, or `null` when it isn't set. Never the value |
| `agentArgv` | on `start` lines of `terminal` and `headless` sessions: the agent's argv, as #80 logged it |
| `way`, `auth`, `nonce`, `wrote`, `reply`, `error` | on `post`: `way` is `hook` (posted while its hook still ran: the line alone, `auth: false`) or `outlived` (posted after its hook's `exit` line: the auth line first, `auth: true`). `nonce` is 8 or more of `A-Za-z0-9_-` inside the posted text, new for each post, and no nonce is part of another. `wrote` says whether the line was written to the socket. `reply` and `error` are what the sender saw, as text, or `null` |
| `exit`, `stderr` | on `exit`: the hook's exit code and what it wrote to stderr. A waiter's `exit` line also holds the `nonce` of the answer it woke with |

The fingerprint is how a fast test can show that no recording holds a token without the repo ever holding one. A file holds the token when some run of `tokenChars` letters and digits in it, whatever sits between them, has that fingerprint, so a value split by JSON escapes or quoting is still found. The field is not named after the token, because gitleaks' generic rule reads any long value beside that word as a key.

### `record.json`

```json
{
  "issue": 3406,
  "baseCommit": "<40 hex, the commit the spike ran on, an ancestor of HEAD>",
  "hooks": ["hooks/<script>"],
  "sessions": {
    "<session id>": { "place": "desktop", "version": "2.1.330", "appVersion": "6.28899.6", "settings": "settings/<name>.json" }
  },
  "posts": [
    { "id": "terminal-asks-hook", "place": "terminal", "mode": "asks", "way": "hook", "outcome": "delivered", "session": "<id>", "nonce": "<nonce>" },
    { "id": "desktop-skips-outlived", "place": "desktop", "mode": "skips", "way": "outlived", "outcome": "held", "session": "<id>", "nonce": "<nonce>", "shown": "<text a logged line holds>" },
    { "id": "headless-skips-outlived", "place": "headless", "mode": "skips", "way": "outlived", "outcome": "no-route", "session": "<id>", "reason": "<why>" },
    { "id": "desktop-auto", "place": "desktop", "mode": "auto", "way": null, "outcome": "no-mode", "reason": "<why the place has no such mode>" },
    { "id": "editor", "place": "editor", "mode": null, "way": null, "outcome": "not-run", "reason": "<why>" },
    { "id": "inbound-hold", "place": "terminal", "mode": "asks", "way": "hook", "inbound": "hold", "outcome": "held", "session": "<id>", "nonce": "<nonce>", "shown": "<text>" }
  ],
  "corpus": ["adapters/corpus/claude-code/2.1.308/<session>"],
  "criteria": {
    "#3406.aee36c46": { "criterion": "<its text, as in the issue>", "status": "PASS | FAIL | BLOCKED | INVALID | INCONCLUSIVE" },
    "#3406.5fbeee00": { "criterion": "…", "status": "…", "session": "<id>", "inbox": { "samples": [{ "nonce": "<nonce>", "ms": 312 }], "p50": 0, "p95": 0 }, "waiter": { "samples": [], "p50": 0, "p95": 0 } },
    "#3406.79aefda5": { "criterion": "…", "status": "…", "quotes": [{ "corpus": "adapters/corpus/claude-code/2.1.308/<session>", "nonce": "<nonce>", "received": "<the whole text the model received>", "turnOrigin": "<as the entry has it>", "origin": {} }] },
    "#3406.3e30684e": { "criterion": "…", "status": "…", "headless": { "woke": true, "post": "<post id>" }, "desktop": { "woke": false, "post": "<post id>" } },
    "#3406.76bfb799": { "criterion": "…", "status": "…", "hold": { "post": "<post id>", "route": "absent" }, "refuse": { "post": "<post id>", "route": "absent" } },
    "#3406.62e7fbf4": { "criterion": "…", "status": "…", "question": "<the token decision, ending in ?>", "answers": [{ "answer": "<words>", "costs": ["<a cost>"] }] },
    "#3406.1fb06894": { "criterion": "…", "status": "…", "recommendation": { "route": "beside | replace | none", "reason": "<for none>" }, "issues": [{ "title": "<title>", "dependsOn": ["#47", "<another proposed issue's title>"] }] }
  }
}
```

- `status` is the spike's own reading. A criterion whose evidence doesn't hold, or with a place, mode or post not run, is never `PASS`.
- `sessions`: every session the record rests on. `version` is the Claude Code version its transcript entries name. `appVersion` is the app's, on `desktop` and `editor`. `settings` is the file the session's hooks came from: every command in it names one of the record's `hooks` scripts by its `hooks/<name>` path, none runs deep-hook, and it wires every hook event the session's log holds.
- `posts`: each post, or each thing in its place. `id` is lower-case letters, digits and hyphens. `mode` is `asks` (payload `permission_mode` `default`), `auto` (`auto`) or `skips` (`bypassPermissions`). `mode: null` stands for every mode, on `no-route` and `not-run` only. `way: null` stands for both ways, on `no-route`, `no-mode` and `not-run` only.
  - `delivered`: a later hook payload or copied transcript entry of the session carries the nonce, and none did before the post.
  - `held` and `refused`: no line of the session ever carries the nonce; the log runs on at least 5 s past the post, or the session's last hook is its `SessionEnd`; and `shown` is text (4 or more characters, not the nonce) that one string of a logged line of that session holds, at or after the post. The post line itself counts, so `shown` may quote the sender's `reply` or `error`. A held post that an approval later let through is a `delivered` post of its own, in another session.
  - `no-route`: its session's hooks were given no inbox address (`env.socket` null on every `start` line), or, for `outlived`, no token, or every write of that way failed.
  - `no-mode`: the place doesn't have that mode. `not-run`: it wasn't run. Both say why.
  - `inbound`: only on a post made in a session whose settings set `crossSessionInbound` to `hold` or `refuse`. Such a post is not part of the place and mode table.
- `corpus`: each corpus session the spike added. None exists at `baseCommit`. A corpus entry also has to pass #47's own suite and the corpus lane (expected events on every payload, a version the facts cover); these tests don't check that again.
- `#3406.5fbeee00`: both sides come from the one `session`. An inbox sample names a `post` line of that session; a waiter sample names the `exit` line (code 2, the nonce on `stderr`) of an `asyncRewake` Stop or StopFailure waiter from that session's settings. `ms` is the time from that line to the session's next hook `start` line. `p50` and `p95` are nearest-rank over `ms`.
- `#3406.79aefda5`: `received` is one whole string of the transcript entry that holds the nonce (its message text). `turnOrigin` and `origin` are that entry's, `null` when it has none.
- `#3406.62e7fbf4`: the entry holds `question` and `answers` and nothing else, and an answer holds `answer` and `costs` and nothing else, so nothing reads as chosen.

### The report (`docs/spikes/3406/README.md`)

The tests read it with white space collapsed. It holds:

- for each post, a line naming its `id` and its outcome (`not run`, `no route` and `no mode` may be written with a space);
- each quote's `received` text, its `turnOrigin`, and each key and value of its `origin`;
- for the hold and the refuse post, a line naming its `id` that says the route reads `absent`;
- the token question, each answer and each cost, in the record's words;
- as its last section, a heading naming what it proposes (it holds "propos", as in "Proposed issues"), with only deeper headings after it. Each proposed issue has a heading of its own there holding its title, and under it "Depends on" with each `dependsOn` entry. With a recommendation of `none`, the report holds its `reason` and may propose nothing.

## How to run

```sh
node --test tests/acceptance/3406/spike.test.mjs
DEEP_SPIKE3406_TRANSCRIPTS=~/.claude/projects node --test tests/acceptance/3406/spike.live.test.mjs
```

- Node 24.22 (as `package.json`'s engines), `git` with `origin/main` fetched, and `gitleaks` on `PATH` for `#3406.79aefda5` (without it that test fails `BLOCKED`). No install and no build: the tests import `scripts/corpus-redact.mjs`, which imports only `node:os`, and read `packages/evidence/gitleaks/gitleaks.toml`.
- Don't pass the folder: the default pattern also picks up the opt-in file.
- The fast file starts no agent, opens no app, posts to no inbox and uses no network. It took under 4 s on a synthetic spike with 230 KB of logs; the token check hashes every window of letters and digits, about 2 s per megabyte.
- The opt-in file is for the machine that ran the sessions, while Claude Code still keeps their transcripts. It reads files only. Without its folder, or with a transcript missing, it fails with `BLOCKED`. Nothing skips.

## Criteria, tests and wrong programs

IDs are the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, with white space collapsed, as `scripts/proof-change.mjs` reads them. `helpers.mjs` holds the texts and the record test recomputes each ID.

The trace lane reads a criterion as proven when any test tagged with it passes. So each criterion has exactly one tagged test, and it passes only when the whole criterion is shown: its check holds, the record says `PASS`, and the same check fails once the log lines it cites are removed. The three other tests carry no ID.

| ID | What its test checks | Wrong programs it fails on |
|---|---|---|
| `#3406.aee36c46` places | Each of the four places, in each of the three modes, by each of the two ways, has a post that was made, a `no-route`, or a `no-mode` with why. A post that was made rests on one `post` line with its nonce, in a session whose transcript names its version, whose argv (terminal: no `-p`; `claude -p`: `-p` or `--print`) or transcript entrypoint (an app) shows its place, whose hook payload names its mode, and whose settings run only the spike's scripts and neither hold nor refuse. Way `hook`: posted before its hook's exit, the line alone. Way `outlived`: after its hook's exit, the auth line first. The outcome is the one the log shows, as above. The report names each post with its outcome. A `not-run` reads `BLOCKED` | A post marked delivered with no later hook payload or transcript entry carrying it. A nonce already in the session's prompt. A held or refused post whose session later carries it. A log that ends right after the post. An `outlived` post made before its hook exited. A payload in another mode. A `claude -p` session without `-p`. A version the transcript doesn't name. Settings that run deep-hook. A missing cell. A report line with another outcome. No route in a session that wrote to its inbox. The editor not run with the record saying `PASS` |
| `#3406.5fbeee00` latency | One session; at least 20 posts and at least 20 waiter wakes. Each sample's line is in that session's log. The session was idle: its last turn hook before it was a Stop or StopFailure at least 1 s earlier, and it waited on no hook (a `hook` post comes from an async entry; an `outlived` one after its hook's exit). It woke on its own: a later line carries the nonce, with no prompt typed in between. `ms` is the log's time to the next hook, within 1 ms. `p50` and `p95` are nearest-rank over the samples | A p95 that isn't its samples'. 19 posts (reads `INCONCLUSIVE`). Waiter samples from another session. A sample whose `ms` isn't the log's. A prompt typed before the wake. A post 300 ms after the stop |
| `#3406.79aefda5` quotes | At least one quote from a corpus session the record lists, with `session.json`, `events.jsonl` and `transcript.jsonl`, not in the base commit. `received`, `turnOrigin` and `origin` are the transcript entry's own, and the report holds them. The spike's logs hold the one post that wrote the quote's nonce, and the corpus session holds a hook payload of that session. No file of the spike and no listed corpus entry holds a fingerprinted token; no recording holds an auth line or a `CLAUDE_CODE_MESSAGING_TOKEN` assignment with a value; every post that sent the token has a fingerprint. On each recording (the logs, each corpus entry), the corpus recorder's redaction changes nothing and gitleaks with the repo's rules finds nothing | A token's value in a corpus transcript. The auth line, escaped twice, in a log. An auth line whose token was never fingerprinted. An env dump with the variable and a value. An origin field that differs from the transcript's. A `received` cut to part of the text. A quote whose nonce no post of the spike wrote. An AWS key in a log (gitleaks). This machine's home folder or an email address in a recording. A corpus session that was already in the base |
| `#3406.3e30684e` wakes | For `claude -p` and for the desktop app: `woke`, and the post it rests on, in that place, under no inbound setting, with its evidence as in the first row. The session had stopped when the post came (its last turn hook was a Stop or StopFailure). `woke: true` needs `delivered` with no prompt typed in between; `woke: false` needs `held`, `refused` or `no-route` | "Woke" resting on a held post. A post made while a tool call ran. A `claude -p` session without `-p`. A nonce that was in the prompt. A desktop session whose transcript names another version |
| `#3406.76bfb799` inbound | For `hold` and for `refuse`: a post marked with that setting, in a session whose settings file sets `crossSessionInbound` to it, with its evidence; not delivered; `route: "absent"`; and a report line naming the post that says absent | A hold post whose session carries its nonce a second later. Settings without the setting. A route recorded as present. A log that ends right after the post |
| `#3406.62e7fbf4` decision | A question (it ends in `?` and names the token), two or more answers, each with at least one cost, all in the report, and nothing else in the entry. Of the files this change adds or edits (against its merge base with `origin/main`), none outside `tests/`, `docs/` and `adapters/corpus/` names `CLAUDE_CODE_MESSAGING_TOKEN` | An entry with a `chosen` answer. An answer with no cost. A statement in place of the question. A file under `packages/` that reads the token |
| `#3406.1fb06894` issues | A recommendation, one of three. The report's last section is the issues it proposes. Each has a title, a heading of its own, and a depends-on (`#<number>`, or another proposed issue's title) that the report repeats. This change touches no file under `packages/`, `crates/` or `adapters/` outside `adapters/corpus/`, and no other file outside `tests/`, `docs/` and `adapters/corpus/` that it touches names `CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_MESSAGING_TOKEN`, `crossSessionInbound` or `cc-socks` | An issue with no depends-on. A report with a section after the proposals. A route under `packages/`. A script under `scripts/` that reads the socket variable. An edited facts file |
| no ID | The record: issue 3406, its base commit, only throwaway hook scripts, well-formed log lines, each session with its evidence, each post once, one entry per criterion with its exact text, a status and the tag its test carries | A missing criterion. A hook script that reaches into `packages/` or `adapters/`. A session with no evidence of its place |
| no ID | Nothing unproven is `PASS`: a criterion whose check reports a problem has another status | The editor not run with the first criterion marked `PASS` |
| no ID | No file of the spike or of its corpus entries holds this machine's home folder, user name or git identity, a home path, or an email address outside `example.*` | An unredacted `cwd` in a payload |
| opt-in, no ID | `spike.live.test.mjs`: every copied transcript entry, in the logs and in the corpus entries, is an entry of that session's own transcript, with the same type, time, version, entrypoint and origin fields and the same nonces | A copied entry with an edited origin field. An invented entry |

### How I checked the tests can pass and fail

On the base, all 10 fast tests and the opt-in test fail with `BLOCKED` (`BASE-FAILURE.txt`). I then built a synthetic, self-consistent spike by hand in a scratch git repository outside this checkout, ran these files against it, and deleted it. Nothing is planted here.

- The spike as the owner's decisions make it (the editor `not-run`, the first criterion `BLOCKED`): 9 pass, and `#3406.aee36c46` fails with `BLOCKED`, naming the editor.
- A control with the editor run too: all 10 pass, so every test can pass. Two more honest spikes built on it also pass all 10: a desktop app that exported no inbox address (one `no-route` for the whole place, `woke: false`), and a recommendation of `none` with no issue proposed.
- Each wrong program in the table above was planted as a twin of the synthetic spike, 60 in all, and each failed its criterion's test (or, for a fault only an untagged test sees, that test) with a message naming the fault. All but two were planted on the control, where every test otherwise passes, so each failure is the twin's own. Dropping each finding's cited log lines makes its check fail.
- The opt-in test passed against the synthetic sessions' transcripts, failed on two more twins (an edited copy and an invented one, which no fast test can see), and failed `BLOCKED` with its folder unset.

## What depends on parts the base commit lacks

- Everything depends on the spike: `docs/spikes/3406/` and its corpus entries. The base has neither.
- The editor extension can't be run on this Mac, so `#3406.aee36c46` can't pass here. Its test fails with `BLOCKED` while the editor is `not-run`, and the PR says `Part of #3406`.
- `#3406.79aefda5` needs the `gitleaks` binary, as #47's suite does.
- The two "builds nothing" checks need `origin/main`, to find what this change touches.
- I could not run `node scripts/affected.mjs` or the proof lanes here: this checkout has no `node_modules`, and this job installs nothing. The tests were written to what `scripts/proof-runs.mjs` reads: a base failure at a `node:assert` assertion under `tests/`, and tags written out in the test file.

## Not covered here

- Scope items with no criterion: a post 20 minutes and 2 hours after the stop, a post after the app was quit and opened again, the 51st waiting message, where a working session read a post, whether a reply reads as your answer, which hooks fire and what `UserPromptSubmit` carries (the logs hold them; no test reads them), what the token is, and what the recommendation names (facts entries, flags, design lines, `from: app` by request ID).
- "On the newest Claude Code the facts cover and on the one installed": no test requires both for every post. A corpus entry needs a covered version to pass #47's suite.
- That a `shown` text shows a hold and not a refusal, that a place really lacks a mode, that the costs are the real ones, and that the proposed issues are the right ones. Those are the reviewer's.
- A token in another form: base64, hex, reversed. No value scrub finds those (design: Secrets).
- That the proposed issues are filed on GitHub, and what the PR says. A repo test can't read either.
- The opt-in test shows copies are true. It can't show a hook log line was written by a hook.

## Assumptions a redraft may revisit

- I picked the folder, the file names and every field name (see above).
- The place and mode table needs both ways to post in each place and mode. The criterion says "the post"; the scope names two ways and asks what happened "for each".
- Mode names come from `adapters/claude-code.facts.json` (`launch.started`: asks is `default`, skipping is `bypassPermissions`) and from the corpus payloads (`auto`).
- A desktop session is known by a transcript `entrypoint` holding "desktop" (the corpus has `claude-desktop`); an editor session by one that is neither that nor `cli`. `claude -p` and the terminal are known by the agent's argv, as in #80.
- A fingerprint of each token is kept in the logs. If the owner wants no digest of a token in the repo either, this check has to move to the opt-in file, fed from outside the repo.
- "The scrub's own check" is read as the corpus recorder's: its redaction leaves the recording unchanged, and its gitleaks scan with `packages/evidence/gitleaks/gitleaks.toml` is clean. That is the check `scripts/corpus.mjs record` runs before a set may join the corpus. The evidence package's scrubber needs a build, and the corpus doesn't use it.
- The waiter's side needs 20 samples too, as the design's "each side takes 20 samples". The criterion gives a number only for the posts.
- "Its first hook" is the session's next hook `start` line after the post, whatever its event. Times are read at the hook's start, so they include the hook process's own start, on both sides.
- Idle means stopped for at least 1 s (as #80) with no hook the session waits on. For the wake of a `claude -p` session, stopped is enough: it never sits idle.
- A post not delivered is watched for 5 s, 2.5 times #25's 2 s wake budget, or to the session's end.
- "Builds nothing" is read against this change, not the tree, so #3405 landing first doesn't fail it. Once merged, those two checks pass trivially.
- One post under `hold` and one under `refuse` is enough, in any place and by either way.
- With a recommendation of `none`, the report may propose no issue. Otherwise it proposes at least one.
