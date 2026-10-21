# Acceptance tests for #339: input the card can trust

These tests were drafted from issue #339 (its text as of October 20), `docs/technical-design.md` (Decided, the rows "Clicks on the question card" and "The app's toolkit"; Panels and devices (trusted ring), "Device gate and capture"; the Trusted ring row of the components table; How we know version 0 works), `docs/canvas-primitives.md` ("Question card" and "Input router, focus and gesture serial") and the base commit `2307398`. Per AGENTS.md, the implementing agent doesn't edit them. A dispute goes to a blind redraft by this job.

The issue is a spike with two findings: whether a screen frame can be taken only while a shortcut is held, and whether macOS names the process that sent an accessibility action. Both are recorded, and the tests hold the record to what they can recompute (invariant 1): the press run's counts from the output the run printed, the held frame's hash and PNG header, the recording's hash and duration from its own container, and the written answer's text in the Decided row. The live tests run the record's commands and read the same report line those print; what needs a person, the macOS permission and a hardware hold, makes them `BLOCKED`, never a pass (invariant 2).

## The surface (my choice, since none was named)

The issue names no file and no command. Following #337 and #573, the spike keeps one public record, `docs/spikes/339/record.json`, plus the files it names under `docs/spikes/339/`, and writes its answer on the sender into the Decided row of `docs/technical-design.md` that starts with `| Clicks on the question card |`. The two runs are commands the record names, run from the repo root, each printing one report line.

### The record, `docs/spikes/339/record.json`

Every path is relative to the repo root and must be tracked by git. Committed or staged both count.

```json
{
  "spike": 339,
  "measuredOn": "<ISO date>",
  "machine": { "model": "Mac15,12", "macosBuild": "<sw_vers -buildVersion>" },
  "capture": {
    "api": "<the macOS API the frame is taken with>",
    "shortcut": "<the chord that must be held>",
    "holdSource": "<where the hold is read from, so a synthetic press can't fake it>",
    "command": ["<argv of the synthetic-press run, from the repo root>"],
    "presses": { "count": 200, "source": "synthetic", "method": "<how the presses were made>" },
    "run": { "log": "docs/spikes/339/<the command's output>.log", "presses": 200, "frames": 0 },
    "heldCommand": ["<argv of the run that waits for a person to hold the shortcut and takes one frame>"],
    "held": { "log": "docs/spikes/339/<that command's output>.log", "frames": 1, "frame": "docs/spikes/339/<the frame>.png", "sha256": "<SHA-256 of the PNG>" }
  },
  "permission": { "api": "<how Screen Recording is asked and read>", "prompt": "<what the system prompt showed>", "state": "granted", "whenDenied": "<what the capture does while denied>" },
  "cursorWindow": { "recording": "docs/spikes/339/<recording>.mov", "sha256": "<SHA-256 of it>", "durationMs": 8000, "sizePoints": { "width": 160, "height": 120 }, "follows": "<how the window follows the cursor>" },
  "sender": {
    "named": false,
    "absence": "<where the API's absence is documented>",   // with named: false
    "api": "<the API that names the sender>",               // with named: true, instead of absence
    "citations": ["https://developer.apple.com/documentation/...", "<Framework>/<Header>.h"],
    "rule": "confirm",                                       // direct with named: true
    "text": "<the written answer, exactly as it appears in the Decided row>"
  }
}
```

### The report line

Each command prints, as its last line of JSON on stdout, one report:

```
{"spike": 339, "mode": "synthetic" | "held", "presses": n, "frames": n, "held": true | false, "permission": "granted" | "denied" | "undetermined"}
```

`presses` is how many presses the run made, `frames` how many frames it captured, `held` whether the hardware shortcut was observed held at any point in the run, and `permission` the Screen Recording state the run saw. Anything printed around it is ignored. The record's `run.log` and `held.log` are each command's kept output, and the tests parse them the same way.

- **A synthetic press** is one made by software: a posted event, a call, anything without a key going down under a finger. The design's Trusted ring row says the card "refuses synthetic clicks", and the Decided row says a synthetic event answers the card only after the OS confirms you. For capture, "only while a shortcut is held" means a synthetic press of the shortcut doesn't count as the hold, so `capture.presses.source` must be `synthetic` and `method` must say how they were made. `holdSource` says where the hold is read from.
- **The synthetic run** (`capture.command`) must report `mode: synthetic`, at least 200 presses, `frames: 0`, `held: false` and `permission: granted`. Zero frames with the permission denied or undetermined prove nothing, since capture was refused; the shortcut held by a person during the run makes it `INVALID`, since a frame then proves nothing either way. `capture.run.presses` and `.frames` must equal the kept output's, and `capture.presses.count` can't exceed its presses.
- **The held run** (`capture.heldCommand`, its own command) is the control: a person holds the shortcut and the run takes one frame. It must report `mode: held`, `held: true`, `frames ≥ 1` and `permission: granted`. Without it a spike that never captures anything would pass the synthetic run with zero frames. The frame is kept as a tracked PNG hashing to `held.sha256`. A held run that reports a frame with `held: false` is a frame without the hold, and fails.
- **The permission flow** (scope): `permission.api` and `prompt` say how Screen Recording was asked and what the system showed, `state` is `granted` for the recorded runs, and `whenDenied` says what the capture does while denied.
- **The cursor window** (scope): `cursorWindow.recording` is a tracked `.mov` or `.mp4`, hashing to `sha256`, whose `moov/mvhd` atom gives a duration of at least 2 s that `durationMs` matches within 50 ms; `sizePoints` is at most 400 points on each side ("a small window"); `follows` says how it follows the cursor.
- **The sender** (criterion 2): `named` is `true` or `false`. With `true`, `api` names the API and `rule` is `direct`: VoiceOver's own actions answer the card directly. With `false`, `absence` says where the API's absence is documented and `rule` is `confirm`: the input router marks the client unknown and VoiceOver's actions answer only after the OS confirms you. `citations` has at least one `https://` URL or SDK header (`<Framework>/<Header>.h`), and `text` cites at least one of them, names `api` (true) or gives `absence` and says the sender can't be named or the client is unknown (false).
- **The Decided row.** `text` must appear, with whitespace collapsed, in the row of `docs/technical-design.md` that starts with `| Clicks on the question card |`. The row names VoiceOver. With `named: true` it names `api` and says VoiceOver's actions answer the card directly; with `false` it marks the client `unknown` and says VoiceOver's actions answer only after the OS confirms you. Either way the row no longer waits on the spike: no cell may still say the spike "finds out" or "finds that" (`/spike finds/`), so a `true` answer rewrites both the decision and its "Reopens if", which today names the yes as what reopens it, and a `false` answer rewrites its "Reopens if" to what would reopen the row now, such as a macOS release that names the client.

### The live runs

`spike.live.test.mjs` runs `capture.command` once from the repo root, on macOS, with a 10-minute timeout, and reads its report line. The run must exit 0 and report as above. A command that can't start is `BLOCKED`, and so is a run that reports the permission `denied` or `undetermined`: a person grants Screen Recording in System Settings, then the run counts. The held run needs a person at the keyboard, so it runs only with `DEEP_339_HOLD=1` in the environment and is `BLOCKED` otherwise. Nothing is pinned to a preflight lane: the runs need the permission and a display.

## How to run

- Public tests, fast and with no build: `node --test tests/acceptance/339/spike.test.mjs`.
- Live tests, which may build the app and run its two commands: `node --test tests/acceptance/339/spike.live.test.mjs`; with a person holding the shortcut when asked, `DEEP_339_HOLD=1 node --test tests/acceptance/339/spike.live.test.mjs`.
- The validator's own tests, which plant wrong spikes in a small temporary git repo: `node --test tests/acceptance/339/validator.test.mjs`. They pass at the base, since they test the tests and not the spike.
- The preflight's `tests/*.test.mjs` pattern doesn't reach this folder.

## Criteria, tests and wrong spikes

IDs are the first 8 hex digits of SHA-256 of each criterion's text, computed with the command from #48's README.

| ID | Criterion | Tests | Wrong spikes it must fail on (planted in `validator.test.mjs`) |
|---|---|---|---|
| `#339.8d46a78e` | No frame is captured without the shortcut held, over 200 synthetic presses | public: the kept output of the synthetic run reports at least 200 presses, zero frames, no hold and the permission granted, the record's numbers agree with it, the presses are synthetic with their method and the hold's source named, and the macOS build is recorded; the held run's kept output reports a frame while held, kept as a tracked PNG with its hash. Live: the synthetic run, run now, reports the same; the held run, with a person, reports a frame | 199 presses. A kept output of 150 presses under a record claiming 200. A record whose presses or frames disagree with its output. A frame captured in the synthetic run, shown or hidden. Zero frames with the permission denied or undetermined. A person holding the shortcut during the synthetic run. Hardware presses passed off as synthetic. No method, no hold source, no command, no macOS build. An untracked output, one with no report line, or the held run's output in the synthetic run's place. A spike that never captures (the held run took no frame). A held run in which the shortcut was never held, with or without a frame. A held run with the permission denied, or the synthetic run's output in its place. A held frame count that disagrees, a frame missing, not a PNG or not the recorded one. No held command, or one that is the synthetic command. Live: frames over 200 presses, 120 presses, a hold during the run (INVALID), the permission denied or undetermined (BLOCKED), a held run with no frame or no hold, a held report for a synthetic run, a non-zero exit, no report line, a command that can't start (BLOCKED) |
| `#339.da6a6508` | The decision says whether an accessibility action's sender can be named, citing the API or its documented absence, and the question card's input rule follows it | public: `named` is true or false; true names the API, false gives the documented absence; at least one citation, a URL or an SDK header, cited in the text; the rule is `direct` with true and `confirm` with false; the text names the API or gives the absence and says so; the macOS build is recorded. The text is in the Decided row "Clicks on the question card", which names VoiceOver, follows the answer (directly and the API, or unknown and the OS confirming you) and no longer waits on the spike | No answer, or "maybe". Named with no API; not named with no absence, or naming an API. No citations, a citation that is neither a URL nor a header, one over http, a text citing none. Not named yet `direct`; named yet `confirm`; no rule. No text; a named text that never names the API; an unnamed text that never gives the absence or never says the sender can't be named. No macOS build. A text not in the row. No sender decision. A row that still says the spike finds out, or whose "Reopens if" still waits on it. Not named: a row that never marks the client unknown, or where VoiceOver still answers directly. Named: a row that never names the API, or where VoiceOver still waits for the OS. A row that never says what VoiceOver does. A design with no such row |

Scope tests, untagged since the trace lane tags only criteria: the frame is taken through the macOS Screen Recording permission flow (planted: no permission API, no prompt seen, the permission denied, a state of "yes", nothing said about a denied permission, no permission flow); a small window follows the cursor, in a kept screen recording (planted: no recording, a GIF, a file that isn't a movie, a recording that isn't the recorded one, a one-second recording, a duration that isn't the recording's, an 800-point window, no size, nothing said about following, no cursor window). The proof items map onto these: the 200-press run is criterion 1's public and live tests, the screen recording of the cursor window is the cursor-window scope test, and the written answer on the sender is criterion 2's two tests.

## What the base commit has

At the base `2307398` there's an app crate, `crates/deep-app`, from the #337 spike, and no `docs/spikes/339/record.json`, so every spike test fails with `no spike record at docs/spikes/339/record.json`: all 6 public tests and both live ones, 8 of 8. `BASE-FAILURE.txt` holds that run. The validator's own tests pass at the base, 77 of 77.

## Assumptions a redraft may revisit

- I picked the record's path, every field name, the report line's shape and the two-command surface. A spike that drives both runs from one binary with different arguments satisfies it; two identical argvs don't.
- "Over 200 synthetic presses" is read as at least 200, and a synthetic press as one software makes. The tests can't tell a synthetic press from a hardware one: they trust `presses.source` and `method`, and the live run's `held: false`. What they do hold is that the run reports its counts and the permission, and that a held run captured a frame under the same permission, so zero isn't the zero of a capture that never works.
- The held run needs a person, so without `DEEP_339_HOLD=1` its live test is `BLOCKED`, and a PR can say `Closes #339` only after a person ran it. The record's held frame and kept output stand in for it in the public tests, as #337's record stands in for its runs.
- The held frame is a tracked PNG, since an untracked file's hash can't be checked. It should show the spike's own cursor window over an empty desktop, nothing private (AGENTS.md: no personal data in evidence). A redraft may replace it with a hash and dimensions if tracking a frame is refused.
- "A small window" is at most 400 points on a side, and a recording of it at least 2 s. Both numbers are mine. What the recording shows isn't checked, only that it's a real movie of that length that hashes as recorded.
- The permission flow is held by the record's words and the report's `permission` field; whether the capture really goes through the OS permission rather than a private path is trusted.
- The Decided row must stop waiting on the spike with either answer. The issue says to "record the answer ... in Decisions", and the row's "Reopens if" today names the yes as what reopens it, so a yes rewrites both cells and a no rewrites the "Reopens if". CONTRIBUTING says `docs/` isn't edited in a feature PR; #337 wrote its decision into its row all the same, and the issue asks for it.
- The citation's contents aren't fetched: a URL on any host over https, or an SDK header name, is accepted and trusted. The wording checks on the text and the row are proxies: "directly", "unknown", "confirm" and a negation near "name", "sender" or "client".
- `machine.macosBuild` is required on both criteria, since the capture APIs, the permission flow and the accessibility APIs are each a macOS version's. The reference-Mac fingerprint and budgets of #337 aren't required: the issue has no budget.
