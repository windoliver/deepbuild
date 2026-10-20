# Acceptance tests for #80: hooks in the Claude desktop app and Codex Desktop

These tests were drafted blind from issue #80 (its text as of October 19), `docs/technical-design.md` and the base commit `6acd16c`, which is `origin/main` and has no spike. The job was told the base was `dcfd7b8`, but the checkout's HEAD is `6acd16c`, one merge later (#246's repo rules). Neither commit has a `spikes/` folder, and the tests read nothing else the two commits differ in, so they fail the same way on both. Per AGENTS.md, the implementing agent doesn't edit these tests. A dispute goes to a blind redraft by this job.

#80 is a spike. Its proof is "Screen recordings and hook logs from both desktop apps", and what it leaves behind is a recorded decision. So these tests don't drive an app. They read what the spike leaves in the repo and check that every finding rests on hook log lines that show it.

## The surface (my choice, since none was named)

Neither the issue nor the design says where the decision, the hook logs, the recordings or the throwaway scripts live, or in what format. I picked the smallest layout that fits the repo: one folder.

```
spikes/80/
  decision.json        the decision record, one entry per acceptance criterion
  hooks/…              the throwaway hook scripts (not deep-hook, not the adapter)
  logs/<name>.jsonl    the hook logs those scripts wrote, redacted
```

Recordings stay outside the repo, because a screen recording can show personal data (AGENTS.md: no personal data in evidence). The record names each one by its SHA-256, its size and its type. Whoever holds them keeps them in one folder as `<sha256>.mp4` or `<sha256>.mov`.

**Owner decision, October 19:** findings on `claude-desktop` don't need a screen recording. There the proof is the hook log plus entries copied from that session's Claude desktop transcript (`~/.claude/projects/<folder>/<session>.jsonl`), which is what the app renders its chat from. Codex Desktop findings keep their recordings. The facts behind it, as given to this job: Claude Code 2.1.299 inside the Claude desktop app 2.42304.0 runs in stream-json mode, and a hook `systemMessage` the chat shows is saved there as `{"type":"attachment","attachment":{"type":"hook_system_message","content":"<the line>"},"timestamp":…}`.

The hook configs the spike installs (in `~/.claude/settings.json` and `~/.codex/hooks.json`) stay at user level and are copied into the record, never into a repo settings file. The repo-rules lint lane (#246) already fails a repo `.claude/settings.json` with hooks or a `.codex/` folder, so these tests don't check that again.

### `decision.json`

```json
{
  "issue": 80,
  "baseCommit": "<40-hex commit the spike ran on, an ancestor of HEAD>",
  "hooks": ["hooks/<script>", "..."],
  "surfaces": {
    "claude-terminal": { "agent": "claude", "agentVersion": "2.1.303", "appVersion": null, "config": { "hooks": {}, "statusLine": {} } },
    "claude-desktop":  { "agent": "claude", "agentVersion": "<Claude Code inside the app>", "appVersion": "<the app's version>", "config": {} },
    "codex-cli":       { "agent": "codex",  "agentVersion": "0.1xx.y", "appVersion": null, "config": { "hooks": {} } },
    "codex-desktop":   { "agent": "codex",  "agentVersion": "<Codex inside the app>", "appVersion": "<the app's version>", "config": {} }
  },
  "criteria": {
    "#80.373518b6": {
      "criterion": "<the criterion's text, as in the issue>",
      "status": "PASS | FAIL | BLOCKED | INVALID | INCONCLUSIVE",
      "findings": [{ "surface": "claude-desktop", "log": "logs/<name>.jsonl", "session": "<session id>", "...": "per criterion, below" }],
      "decision": { "...": "per criterion, below" }
    }
  }
}
```

- `config` is the hook config the spike installed on that surface, with home folders written as `~`: Claude Code settings with `hooks` (and `statusLine` when there is one), or the contents of Codex's `hooks.json`. Both share one shape, `{ "hooks": { "<Event>": [{ "matcher"?, "hooks": [{ "type", "command", "timeout"?, "async"?, "asyncRewake"? }] }] } }`. Every command names one of the record's `hooks` scripts by a path containing `spikes/80/hooks/`.
- The version tested on a surface is its `agentVersion` and, for an app, its `appVersion`. A finding that rests on "the version tested with none" points at these.
- `status` is the spike's own reading of the criterion. A criterion whose evidence doesn't hold is never `PASS`.
- `recording`, where a finding has one, is `{ "sha256": "<64 hex>", "bytes": <n>, "type": "video/mp4" | "video/quicktime" }`. Every finding on `codex-desktop` has one, except a `route` finding with `route: null` and the ConfigChange findings, which the criteria let rest on the version tested. A finding on `claude-desktop`, with the same exceptions, has a `recording` or a `transcript` in its place.
- `transcript`, on a `claude-desktop` finding only, is the repo-relative path of a log under `logs/` (for example `logs/claude-desktop-transcript.jsonl`) holding entries copied from that session's transcript. Each line there has `surface: "claude-desktop"`, the finding's `session`, `phase: "copied"`, `event` set to the entry's kind (`hook_system_message`, `user`, `assistant`, `queue-operation`, …), `at` from the entry's timestamp, and `payload` holding the copied entry. Keep it apart from the hook log the finding cites.

### Hook log lines

Each line of `logs/*.jsonl` is one JSON object. The throwaway scripts write them. Each line holds:

| Field | Meaning |
|---|---|
| `at` | epoch milliseconds when the line was written |
| `surface` | one of the four surface IDs above. A log line proves things only about its own surface |
| `session` | the payload's `session_id` |
| `event` | the hook event (`Stop`, `PreToolUse`, `ConfigChange`, …), `statusLine` for the status line command, or `token_count` for a copied Codex rollout entry |
| `invocation` | an ID that every line from one hook process shares. A `copied` line has none |
| `phase` | `start` (the hook began; `payload` holds its stdin JSON, redacted), `beat` (still running), `reply` (`reply` holds what it printed, parsed), `exit` (`exit` and `stderr`), `answer` (an answer became ready to deliver), or `copied` (an entry copied from a transcript or rollout; `payload` holds it) |
| `nonce` | on a line that delivers something, a token of 8 or more characters inside what it delivered |
| `checkMs` | on a held Stop's reply, how long the hook's own check ran |
| `agentArgv` | on a `claude-terminal` line, the agent's argv (the hook's parent process) |
| `ask` | on the hook line that read a message typed mid-turn: `{ "text": "<what the person typed>" }` |

A nonce "reaches the agent" when a later `start` line in the same session carries it in its payload, for example in the next Stop's `last_assistant_message`. Before the line that delivered it, no line in that session carries it.

### Findings and decisions, per criterion

| Criterion | `findings` (fields beyond `surface`, `log`, `session`) | `decision` |
|---|---|---|
| `#80.373518b6` held stop | one per desktop app: `invocation` of the held Stop, `recording` | |
| `#80.6231c088` idle wake | `claude-terminal` and `claude-desktop`: `result: "woke"` with `invocation` (the `asyncRewake` waiter), or `result: "fallback"` with `fallback: { route: "<event that delivered it>", delayMs }` | |
| `#80.9492ec1f` typed mid-turn | `claude-desktop`: `invocation` of the first hook after the message was typed, whose line holds the `ask` (on Claude Code 2.1.303, the UserPromptSubmit that fires at once for it), `typedAt` (epoch ms, read from the recording), `recording` | |
| `#80.8c6cf36a` verdict line | one per desktop app: `invocation` whose reply printed the line; on `codex-desktop` a `recording`, on `claude-desktop` a `transcript` holding the `hook_system_message` entry | |
| `#80.1af2fb72` first window reading | `claude-desktop` (`observed`: it ran the status line command) and `codex-desktop` (`observed`: it wrote token events with `rate_limits`, shown by `copied` `token_count` lines) | `firstWindowReading: { "<surface>": "<how>" }` for each app with `observed: false` |
| `#80.014d1b64` Codex 45-minute hold | `codex-cli` and `codex-desktop`: `invocation` of the held Stop, and `result: "held"` or `result: "cut"` with `endedAfterMs` | `slowLaneHoldMs` |
| `#80.9b528e55` continuation cap | one or more Claude Code surfaces: `from` (the invocation of the run's first Stop), `endedAfter` (continuations before the turn ended) | `stopContinuationCap` |
| `#80.b11edf91` Codex Desktop hooks | `codex-desktop`: `observed` (some entry fired), `recording` | `codexDesktopMode: "watch-only"` when none fired |
| `#80.119fc62b` budgets | none; the entry holds `budgets` (below) | |
| `#80.15c33f50` routes | `kind: "line"` on all four surfaces: `route` (what put the line in the chat) or `null`; with a route, `call` and `callEnd` (the PreToolUse and PostToolUse invocations of the 60 s call), `invocation` (the delivering line) and `recording` (or, on `claude-desktop`, `transcript`). `kind: "delete"` on both apps: `action` (`"delete"` or `"archive"`), `deletedAt` (when the session was deleted or archived), `route` (the event that fired before it) or `null`, and with a route a `recording` (or, on `claude-desktop`, the hook log plus `transcript`). Each app needs a finding with `action: "delete"`. An archive finding counts only as an archive | |
| `#80.661b1ddf` ConfigChange | `claude-terminal` and `claude-desktop`: `observed` (ConfigChange fired), `call` (the PreToolUse invocation of the Bash call whose child edits `~/.claude/settings.json`) | |

`budgets`:

```json
{
  "machine": { "model": "Mac15,7", "chip": "Apple M3 Pro", "cpus": 12, "memoryBytes": 38654705664, "power": "AC", "lowPowerMode": false, "thermal": "nominal", "macOS": "<build>" },
  "baseCommit": "<40-hex merge base>",
  "base": null,
  "initialReason": "<why there is nothing to compare with, when base is null>",
  "hookOverheadMs": { "claude-desktop": { "samples": [20 or more ms], "p95": 0 }, "codex-desktop": { "...": "..." } },
  "heldStopExtraMs": { "claude-desktop": [{ "ms": 0, "log": "logs/<name>.jsonl", "invocation": "<a held Stop>" }], "codex-desktop": [] }
}
```

`p95` is the nearest-rank p95 of `samples`. `base` holds the merge base's readings in the same shape when it has a spike to compare with. Each `heldStopExtraMs` sample is the time a held stop added beyond its check, citing a held Stop whose reply carries `checkMs`.

## How to run

- Fast tests read files only. They start no agent, open no app and spend nothing: `node --test tests/acceptance/80/spike.test.mjs`.
- The opt-in test checks the recordings, which only the person who made them holds: `DEEP_SPIKE80_RECORDINGS=<folder> node --test tests/acceptance/80/spike.live.test.mjs`. Without that variable, or with a recording missing, it fails with `BLOCKED` in its message. Nothing skips.
- Don't pass the folder (`node --test tests/acceptance/80/`). Node 23 treats it as one file, and the default pattern also picks up the opt-in file.

## Criteria, tests and wrong programs

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed and the leading `- [ ] ` dropped. They come from the same command as #48's README, with the issue's eleven criterion lines on stdin. `helpers.mjs` holds the texts and recomputes each ID in the record test.

Every criterion test does three things. Its check holds on the spike's logs and record. The record says `PASS`. And the same check run again with the log lines the finding cites removed must fail, so a finding with no log line behind it never passes. Three tests cover every criterion: the record test, the "nothing unproven is PASS" test and the privacy test.

| ID | Tests (`spike.test.mjs` unless named) | Wrong program it must fail on |
|---|---|---|
| `#80.373518b6` | A Stop starts, its hook replies `decision: block` with a reason holding a nonce, nothing in the session saw the nonce before, and a later hook payload carries it. Checked on both desktop apps, each with a recording | A spike that shows the hook replying but never the agent receiving it. One whose nonce was already in the prompt. One that proves it in one app or from a terminal log only |
| `#80.6231c088` | `woke`: an `asyncRewake` Stop waiter from the installed config exits 2 with the nonce on stderr at least 1 s after the stop, no prompt is typed in between, and a later payload of the agent's carries the nonce. The UserPromptSubmit that Claude Code starts the woken turn with, whose prompt is its own notification carrying the waiter's whole stderr, counts as the wake, not as a typed prompt, and doesn't count as the agent carrying the answer. `fallback`: the answer becomes ready, the named route's reply delivers it, the documented delay matches the log within 1 s, and the agent then carries it. The terminal session's argv has no `-p` or `--print` | A terminal session run with `claude -p`. A wake that happened only because someone typed. A waiter with no idle time. A fallback whose stated delay isn't what the log shows. A desktop finding backed by a terminal log |
| `#80.9492ec1f` | In the desktop app, the first hook after `typedAt` records an `ask` holding the typed nonce, whichever event it is. On Claude Code 2.1.303 that's a UserPromptSubmit fired at once for the typed text. The message was typed mid-turn: the last PreToolUse before `typedAt` had no PostToolUse, PostToolUseFailure or Stop before that hook, and the call then ends after it, before any Stop. From the previous turn's Stop on, no hook of another invocation saw the nonce before the ask, and the ask's text isn't the text of an earlier prompt in the session | An ask at a later hook than the next one. A message typed after the tool call or the turn ended. A call that never ends inside the turn. A nonce in the same turn's prompt, or anywhere in that turn before the ask. An ask that replays an earlier prompt |
| `#80.8c6cf36a` | On both desktop apps, a hook reply holds one line, with no newline, that names one of the five verdicts and carries its nonce. On Codex Desktop, with a recording. On the Claude desktop app, the session's copied transcript has a `hook_system_message` entry at or after that reply (its `at` equal to its own `timestamp`) whose `attachment.content` is that same line | A multi-line message or one without a verdict. One app only. No recording on Codex Desktop. A Claude desktop line with no matching `hook_system_message` entry, or one holding a different line: it never reached the chat |
| `#80.1af2fb72` | `observed: true` needs a `statusLine` line from the desktop app, or a copied `token_count` line with a `rate_limits` object from Codex Desktop. `observed: false` needs `firstWindowReading` for that app | Claiming the status line runs with no log line to show it. An app that does neither with no first window reading named |
| `#80.014d1b64` | On the CLI and Codex Desktop, the installed `hooks.json` has a Stop entry from `spikes/80/hooks/` with timeout 2700. `held`: the reply comes at least 2,695 s after the stop, and the agent then carries the reason. `cut`: no reply, and the hook's last line falls within the last minute before `endedAfterMs`, which is under 45 minutes. `slowLaneHoldMs` is at most 2,695,000 ms and at least 5 s under every cut | A hold shorter than 45 minutes. A hook whose timeout isn't 2700. A slow lane held right up to the timeout or past a cut |
| `#80.9b528e55` | From `from`, consecutive Stops each answered with `decision: block`, with no other hook in between. Either the turn ends after the last block (the cap) and `endedAfter` equals the continuations seen, or nine continued. `stopContinuationCap` is at least 1 and at most what was seen | A run broken by a tool call before nine send-backs or the cap. A miscounted `endedAfter`. A planned cap above the observed one |
| `#80.b11edf91` | The installed Codex Desktop config has SessionStart, UserPromptSubmit, PreToolUse, PostToolUse and Stop entries from the spike. `observed` agrees with whether any hook line came from `codex-desktop`, and none firing makes `codexDesktopMode` `watch-only` | Recording "none fires" while a Codex Desktop line exists, or the reverse. None firing without watch-only. A "none fires" with no entries installed |
| `#80.119fc62b` | The machine is the reference Mac by model, chip, cores and memory, with Low Power Mode off. It names its power state (`AC` or `battery`), its thermal state and its macOS build, and readings count on either power source (owner decision, October 19). The merge base is an ancestor of HEAD, and the merge base's readings are there, or `base: null` with an `initialReason`. Each desktop app has at least 20 overhead samples whose nearest-rank p95 is the recorded p95, and at least 5 held-stop samples, each under 20 ms, citing a held Stop whose own time beyond `checkMs` isn't above the sample | A reading from another Mac model, or with Low Power Mode on. A machine record that doesn't name its power or thermal state. A p95 that doesn't match its samples. A held stop at 20 ms or more. Samples citing no hold, or below what the hook itself spent |
| `#80.15c33f50` | Line: on all four surfaces, a route needs a PreToolUse and PostToolUse at least 60 s apart, a line with a nonce strictly between them, and a recording. `null` rests on the surface's version. On the Claude desktop app, a transcript may stand in for the recording. Delete: on both apps, each finding's `action` is `delete` or `archive`, and each app has at least one `delete`. A route needs its event firing in the session at or before `deletedAt`, and a recording, or on the Claude desktop app a transcript. `null` with a log needs no SessionEnd in that session | A line delivered after the call ended. A call under 60 s. A route without a recording or, on the Claude desktop app, a transcript. A "nothing fired" with a SessionEnd in the log. A record that says PASS with only archive findings on an app: the delete case is still open, so this test and "nothing unproven is PASS" fail |
| `#80.661b1ddf` | The installed settings on both Claude surfaces have a ConfigChange entry. The finding's call is a Bash PreToolUse whose input names `settings.json`, it ends, and the session's hooks fire after it. `observed` agrees with whether a ConfigChange naming `settings.json` follows. Separately: when no surface observed it, no file under `adapters/`, `packages/`, `crates/` or `scripts/` names ConfigChange | "Not fired" with a ConfigChange line in the log. "Fired" with none. A test where no ConfigChange entry was installed. An adapter that adds ConfigChange when the decision says it fires nowhere |
| every criterion | The record: issue 80, its base commit, the four surfaces with agent and app versions and installed configs, only `spikes/80/hooks/` scripts that don't call deep-hook or reach into `packages/` or `adapters/`, one entry per criterion with its exact text and one of the five statuses, a recording on each Codex Desktop finding and a recording or a well-formed copied transcript on each Claude desktop finding, a transcript only on `claude-desktop`, and well-formed log lines | A record missing a criterion, a surface or a version. A hook config that runs deep-hook. A Codex Desktop finding with no recording. A Claude desktop finding with neither a recording nor a transcript |
| every criterion | Nothing unproven is PASS: any criterion whose check reports a problem has a status other than `PASS` | A record that says PASS for a criterion its logs don't show |
| every criterion | Privacy: no file under `spikes/80/` holds this machine's home folder, user name, git name or git email, any home path, or an email address outside `example.*`. None is a recording, and no file git lists in the checkout has a recording's hash | Unredacted `cwd` or `transcript_path` in a payload. A recording committed to the repo |
| recordings | `spike.live.test.mjs`, opt-in: each recording the record names is in the folder, outside the checkout, with its size and hash, and whole: an `ftyp` start, top-level boxes adding up to the file, and a `moov` box | A recording that's missing, swapped, cut short or kept inside the repo |

### How I checked the tests can pass and fail

At the base, all 15 fast tests and the opt-in test fail, each with `BLOCKED` in its message, because there's no `spikes/80/` (`BASE-FAILURE.txt`). To check that the tests can pass and that each one fails on a wrong program, I built a synthetic spike by hand outside the repo and ran this file against it in a scratch git repository. It's not kept, and nothing is planted in this checkout. The consistent spike passes all 15. Each of these wrong programs fails its criterion's test: `claude -p` in the terminal, a prompt typed before the wake, a two-line verdict, a 2,000 s Codex hold, a slow-lane hold at the full timeout, a tool call inside the send-back run, a planned cap above the observed one, "no Codex Desktop hook fires" beside a Codex Desktop log line, a reading from another Mac model, a wrong p95, a 25 ms held-stop sample, a line delivered after the call ended, "ConfigChange not fired" beside a ConfigChange line, and a missing first window reading. A home path in a config fails the privacy test. A missing Codex Desktop recording fails the record test, and so does a Claude desktop finding with neither a recording nor a transcript. After the owner's October 19 decision, the synthetic spike rests its Claude desktop findings on copied transcripts and still passes all 15. A Claude desktop delete with a route, resting on the hook log and a transcript, also passes. A Claude desktop verdict line with no `hook_system_message` entry, or with an entry holding another line, fails the verdict test. A record that says PASS with only archive findings fails the route test and "nothing unproven is PASS". A finding pointing at a nonexistent hold fails both its test and "nothing unproven is PASS". An adapter file naming ConfigChange beside a decision where it fires nowhere fails the adapter test. Dropping each finding's cited log lines makes its check fail. The media check accepts a whole MP4 and rejects one cut short and one with no `moov`.

## What depends on parts the base commit lacks

- Everything depends on the spike itself: `spikes/80/`, its scripts, logs and record. Nothing in the base has them.
- The adapter half of `#80.661b1ddf` ("the Claude Code adapter adds a ConfigChange entry only where the decision says it fires") depends on #18's adapter, which doesn't exist yet. The test checks only the case it can see: when ConfigChange fires nowhere, nothing under `adapters/`, `packages/`, `crates/` or `scripts/` names it. Whether the adapter adds the entry on exactly the surfaces where it fires is #18's to prove.
- The recordings live outside the repo. Only `spike.live.test.mjs`, run by hand where they are, checks them. Until someone runs it and keeps its output, every criterion that cites a recording stays open, and the PR says `Part of #80`. Claude desktop findings that rest on a copied transcript don't wait on it. What a recording shows (the verdict line in the chat, the line during a call) is for the person reviewing the spike to watch. No test can see it.

## Not covered here

- "#120 and #88 keep the criteria that need a route only where the decision names one" is an edit to two GitHub issues (#88's criteria now sit in its parts, #342 for deletes). A repo test can't check it without the network. It's left to review.
- "In the local preflight" in `#80.119fc62b`. The spike's readings need a person in each desktop app, so they can't be a preflight lane that runs unattended, and adding one would mean code a throwaway spike shouldn't have. The test holds the recorded readings to the reference Mac, the merge base and the limits. Whether a later lane must re-measure them is for a redraft or the owner.
- The Codex Desktop trust step and the scope's fallback that delivers context on the next prompt have no criterion of their own. The fallback is checked only where `#80.6231c088` uses it.

## Assumptions a redraft may revisit

- I picked the folder, file names, record fields, log line fields, phases, surface IDs, `observed`, `result`, `route` and the decision field names myself (see above).
- "Both apps" means the Claude desktop app and Codex Desktop. "The terminal" in `#80.15c33f50` means both terminal surfaces, Claude Code and Codex CLI, so the line-during-a-call finding is required on all four surfaces. The delete finding is required on the two apps only, since #88 is about desktop deletes.
- The criterion text "continues with its reason after 45 minutes" is read as the hold's reply arriving at least 2,695 s after the stop. That's 45 minutes less the 5 s the design's timing relations keep between a hold and its hook's timeout. "The slow lane's hold is set below it" is read as at least 5 s below every cut and at most 2,695,000 ms.
- "Idle" means the waiter delivered at least 1 s after the stop with no prompt typed, as in #48's idle-wake scenario. A UserPromptSubmit after the waiter's exit whose prompt holds the waiter's whole stderr is the wake: nobody could type a nonce that nothing had shown them. The check doesn't depend on the notification's wording.
- Ruled on a dispute, October 20, from Claude Code 2.1.299 in the Claude desktop app. The person had sent an ordinary prompt in an earlier, finished turn that quoted the same word. In the later turn, a message typed during a Bash call was enqueued with no hook firing, and the call's PostToolUse, the next hook, held the ask. So the freshness rule now looks only inside the turn that holds the running call, after the previous turn's Stop. To keep that from letting a hook replay an old prompt as the ask, the ask's text must not equal an earlier prompt's text.
- Mid-turn is read as "while a tool call runs", the only state a hook can tell apart from a new turn: the call's PreToolUse has no PostToolUse yet and no Stop came between. A message typed between two calls of one turn isn't tested.
- The `-p` check applies only to the terminal session, which the spike starts. The desktop app starts its own Claude Code, and its argv isn't the spike's to choose.
- Redrafted on October 19 after a dispute, from hook payloads observed on Claude Code 2.1.303 (terminal, interactive in a pty): a message typed mid-call fires UserPromptSubmit at once inside the running turn, and an `asyncRewake` wake starts its turn with a UserPromptSubmit carrying the waiter's stderr. Only these two checks changed.
- The typed-mid-turn criterion is required in the Claude desktop app, where the issue's scope puts it. It isn't required elsewhere.
- The continuation cap needs only one Claude Code surface. The planned cap must be at most the smallest one observed, since a gate that plans for more would lose the send-back past it.
- Owner decision, October 19: budget readings on the reference Mac count on battery or AC. Only the model, chip, cores and memory must match, and Low Power Mode must be off. The power and thermal states are recorded but not gated. This departs from the design's rule (mains power, thermal nominal) for this spike only.
- Budgets need at least 20 overhead samples per app, as the design's 20 samples a side, and at least 5 held-stop samples per app, each under 20 ms, as its five-run timing rule. p95 is nearest-rank.
- Every Codex Desktop finding has a recording, since the proof is screen recordings from the desktop apps. The exceptions are where a criterion lets the version tested stand in (`route: null`, and ConfigChange's "the recording or the version tested"). On the Claude desktop app, a copied transcript may stand in for a recording (owner decision, October 19). For the verdict line it must hold the line itself. For the other Claude desktop findings, the hook log carries the proof as before, and the transcript only has to be well formed.
- Redrafted again on October 19 for that decision. Delete findings also gained `action`, because a desktop app can archive a session as well as delete it. An archive proves nothing about a delete, so `#80.15c33f50` stays open on an app with only archive findings.
- The privacy test reads this machine's home folder, user name and git identity at run time and never stores them. An email address is allowed only at an `example.*` domain.
