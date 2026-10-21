# Acceptance tests for #337: the gpui-kit spike and its decision

These tests were drafted from issue #337 (its text as of October 19), `docs/technical-design.md` (Decided, "The app's toolkit"; Panels and devices; Every task carries its own budgets; The reference Mac), `docs/canvas-primitives.md` ("Panel runtime and panel host") and the base commit `0c5e145`. Per AGENTS.md, the implementing agent doesn't edit them. A dispute goes to a blind redraft by this job.

The issue is a spike, so most of what it proves is a record: the numbers, the agents' panels, their rounds and the decision. The tests don't take the spike's word for what they can recompute. They judge each budget from its five runs. They work out from the outcomes which criteria failed, and from that what the decision must be. They check that each displayed number matches its runs, and they check file hashes, PNG headers, the quotes the report shows and the decision's text in the technical design. The live tests run the spike's headless tests and read their results.

## The surface (my choice, since none was named)

The issue says to record the numbers and the decision "in the technical design". It names no file for the rest, and no command for the headless tests. Following #573, the spike keeps one public record, `docs/spikes/337/record.json`. Its decision text also goes into the Decided table's "The app's toolkit" row of `docs/technical-design.md`. The headless tests are a command the record names, run by a local preflight lane.

### The record, `docs/spikes/337/record.json`

Every path is relative to the repo root and must be tracked by git. Committed or staged both count.

```json
{
  "spike": 337,
  "mergeBase": "<40-hex merge base the budgets are compared with; an ancestor of HEAD>",
  "machine": { "model": "Mac15,7", "chip": "Apple M3 Pro", "memoryBytes": 38654705664, "power": "ac", "lowPowerMode": false, "thermalState": "nominal", "macosBuild": "<sw_vers -buildVersion>" },
  "window": { "screen": "<screen id>", "sessionRows": 1000 },
  "menuBar": { "captured": true, "screen": "<screen id: its own, not the window's or a panel's>", "count": 3 },
  // or, when the count is an OS menu-bar item gpui-kit's test support can't capture (redrafted, see below):
  // "menuBar": { "captured": false, "reason": "<why it isn't captured>", "count": 3, "test": "<libtest name: its own headless check>", "checks": ["<what that test asserts>"] },
  "screens": [
    { "id": "sessions", "test": "<libtest name, as `cargo test` prints it>", "snapshot": "<tracked .png: the render the test compares with>", "clicks": ["<what the test clicks>"] }
  ],
  "panels": [
    {
      "agent": "claude-code | codex",
      "agentVersion": "<the agent's version>",
      "file": "<tracked .js or .mjs, the panel as it passed>",
      "sha256": "<SHA-256 of that file>",
      "screen": "<screen id of this panel>",
      "inputs": ["issue#337", "docs/<a doc at the merge base>",
                 "https://github.com/<owner>/<repo>/blob/<40-hex commit>/<path to a doc>",
                 { "doc": "docs/<a doc this change adds, such as the task statement>.md", "sha256": "<SHA-256 of it as given>" }],
      "rounds": [{ "result": "fail", "fix": "<what was fixed>" }, { "result": "pass" }],
      "runtime": { "origin": "agent_built", "runtime": "panel_host", "thread": "host_main", "policy": "empty", "update_budget_ms": 4,
                   "limits": { "interrupt": true, "heap": 268435456, "stack": 1048576, "microtasks": 100000, "pending": 1024 }, "output": "element_tree", "jit": "off" }
      // or, loaded in the app through gpui-shell, a declared deviation:
      // "runtime": { "origin": "agent_built", "runtime": "in_process", "thread": "ui_main", "policy": "empty", "update_budget_ms": 4, "limits": { ...the same },
      //              "output": "element_tree | <what it outputs>", "jit": "off | on",
      //              "deviation": { "fields": ["runtime", "thread", "<output or jit, if they differ>"], "reason": "<why>", "until": "panel_host" } }
    }
  ],
  "stocks": { "quotes": "<tracked .json of recorded quotes>", "test": "<libtest name>", "result": "pass | fail" },
  "report": { "test": "<libtest name: the click that opens the report in the browser>", "result": "pass | fail", "sample": "<tracked .html: the report that opened>" },
  "headless": { "command": ["cargo", "test", "-p", "<crate>", "..."] },
  "build": { "kind": "clean | incremental", "command": ["<argv timed>"], "ms": 390000, "display": "6.5 min" },
  "budgets": {
    "coldStartMs":    { "runs": [5 numbers], "display": "0.42 s", "method": "<how>", "base": null, "baseReason": "<why the merge base has no runs>" },
    "idleCpuPercent": { "runs": [5 numbers], "display": "0.3%",   "method": "<how>", "base": null, "baseReason": "..." },
    "memoryBytes":    { "runs": [5 numbers], "display": "142 MB", "method": "<how>", "base": null, "baseReason": "..." },
    "appBytes":       { "runs": [5 numbers], "display": "48 MB",  "method": "<how>", "base": null, "baseReason": "..." },
    "preflightMs":    { "runs": [5 numbers], "display": "3.9 min", "method": "<how>", "base": { "runs": [5 numbers] } }
  },
  "decision": {
    "toolkit": "gpui-kit | native",
    "failed": ["<criterion IDs that failed, e.g. #337.649cb21e>"],
    "native": { "macos": "Swift" },
    "extensionPanels": "gpui-shell | wait",
    "agentPanels": "panel_host | in_process",
    "webView": false,
    "text": "<the decision with its numbers, exactly as it appears in the toolkit row>"
  }
}
```

- **Units.** Cold start and the preflight are in ms, idle CPU in percent as `ps -o %cpu` gives it (of one core), and memory and app size in bytes. A megabyte is 10^6 bytes, as `benchmarks/budgets.json` counts it. `display` is `<number> <unit>`. The unit is `ms`, `s` or `min` for times, `%` for CPU and `MB` for bytes. It gives the worst of the five runs, to the precision it's written with. The build's `display` gives `build.ms` the same way.
- **The budgets.** Each budget is five runs after warm-up, judged by the design's rule. It passes when all five are strictly under the issue's limit: 1,000 ms, 1%, 200 MB, 60 MB and 300,000 ms. It fails when all five are over the limit by more than the margin, the larger of 5% and the five runs' spread. Anything else is INCONCLUSIVE, and so is every run off both reference Macs. `machine` uses the field names of `scripts/benchmark.mjs`'s `fingerprint()`. Both reference Macs count: its `model`, `chip` and `memoryBytes` must match either Mac15,7 (Apple M3 Pro, 36 GB) or Mac15,12 (Apple M3, 16 GB), on mains power, with Low Power Mode off, the thermal state nominal and a macOS build recorded. A budget is compared with the merge base by recording the base's five runs. The merge base has no app, so the app's four budgets may give `base: null` with a `baseReason`. The preflight's base runs are required, since the base has a preflight.
- **The decision.** The tests work out which criteria failed from the record's outcomes:
  - `#337.05b344ec` fails unless each agent has exactly one panel whose last round passed after at most two rounds of fixes.
  - `#337.e2f507ac` fails unless `stocks.result` and `report.result` are both `pass`.
  - `#337.649cb21e` fails unless all five budgets PASS.

  `decision.failed` must be exactly that set. The toolkit is `gpui-kit`, with `extensionPanels: gpui-shell`, only when the set is empty. Otherwise it's `native`, with `native.macos: Swift` and `extensionPanels: wait`, and its text names Swift and says the panels wait. `webView` is always `false`. The text has to include every budget's `display` and the build's. It also has to appear, with whitespace collapsed, in the row of `docs/technical-design.md` that starts with `| The app's toolkit |`.
- **Panels.** `inputs` are what the agent was given, since the issue says the panels are written "from the docs alone" (redrafted, see below). Each names one input precisely and is a doc, never code:
  - `issue#337`.
  - A path under `docs/` that exists at `mergeBase`.
  - gpui-kit's own docs upstream, as `https://github.com/<owner>/<repo>/blob/<40-hex commit>/<path>`. The commit is a full hash, never a branch or tag. The path ends in `.md`, `.markdown`, `.mdx`, `.rst`, `.txt` or `.adoc`, and no segment of it is `examples`, `example`, `tests`, `test`, `fixtures`, `benches` or `snapshots`. A URL into this repo is refused: its docs come in by the other two forms.
  - A doc this change adds, `{ "doc": "<path>", "sha256": "<hex>" }`: a tracked file under `docs/` with a doc extension, hashing to `sha256`, that isn't a recorded panel. It holds no script code block (a fence tagged `js`, `javascript`, `mjs`, `cjs`, `jsx`, `ts`, `tsx` or `typescript`, or an untagged fence with `export`, `import`, `function`, `return`, `const`, `let` or `=>`), and no line of 30 or more characters from either recorded panel. This is where the task statement goes: what to build and the ids the headless test clicks.
  - Anything else is refused: source code, examples, tests, another agent's panel, a reference implementation, or an input of any other shape. Round 0 is the first build, and every later round follows a fix, so `rounds.length - 1` counts the fixes. Every round but the last must have failed and must name its `fix`. `runtime` holds the issue's Fields for these panels, in snake_case. They were built by agents, so `origin` is always `agent_built`, never `shipped`. The policy is `empty` (plus DeepBuild's modules), the update budget is over 0 and at most 4 ms, and the limits are the issue's in bytes, wherever the panel runs. Where it runs is one of two (redrafted, see below):
  - **In the panel host:** `runtime: panel_host`, `thread: host_main`, `output: element_tree`, `jit: off`, and no `deviation`.
  - **In the app's process, as a declared deviation:** `runtime: in_process` on the UI thread, `thread: ui_main`, with `runtime.deviation`. `output` names what the panel outputs and `jit` is `off` or `on`, as they were. `deviation.fields` lists exactly the fields among `runtime`, `thread`, `output` and `jit` that differ from the panel host's values, no more and no fewer. `deviation.reason` says why, and `deviation.until` is `panel_host`. An agent-built panel `in_process` without a deviation is refused, as is a deviation on a panel-host panel.
  - **The decision says which.** `decision.agentPanels` is `in_process` when either agent's panel ran in process, and `panel_host` otherwise. When it's `in_process`, the decision text says the panels ran in process (`in process` or `in-process`), has a sentence on the panel host, and no sentence that names the panel host may claim it (proven, passed, works, verified, validated, tested, ran, runs, holds, fits) without a negation (not, never, no, untested, unproven, unmeasured, yet, n't). For example: "Both agents' panels ran in process through gpui-shell; the panel host isn't tested by this spike and lands in R2."
- **Recorded quotes.** The quotes file is `{"recorded": "<ISO date>", "source": "<where they were recorded>", "quotes": [{"symbol": "AAPL", "time": "<ISO>", "price": 231.4}]}`. The report sample must show every recorded symbol. A panel file that uses `fetch(`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `child_process`, `require(`, `Deno.` or `Bun.` is refused, since a panel never reaches the network or a program itself.
- **Screens.** Every screen has a headless test, at least one click and its own tracked PNG snapshot. Two screens can't share one image. The session-list window and both agents' panels must each be a screen.
- **The menu-bar count** (redrafted, see below) says whether it was captured, as `menuBar.captured`, which is required and is `true` or `false`.
  - **Captured:** `menuBar.screen` is a recorded screen, held to the rules above, and it isn't the window's screen or a panel's. So its PNG is its own, distinct from every other screen's. It has no `reason`, `test`, `checks` or `snapshot` of its own.
  - **Not captured:** the record says why in `reason`. `test` names the headless test that checks the count, which isn't any screen's test, and `checks` names what it asserts. It names no `screen` and no `snapshot`, so no other screen's image can stand in for the menu bar's. The live run requires `test` to report `ok`, like every screen's.
- **The preflight, no display, no CI.** The record's `headless.command` must be a command some lane in `scripts/lanes.mjs`'s `checks` runs. Failing that, it must be `cargo test -p <a workspace crate>` while a lane runs `cargo test --workspace`. It may not start a display server. `.github/workflows/` must be absent or empty.
- **No web view.** On either branch of the decision, `Cargo.lock` holds no `wry`, `webkit2gtk`, `webkit6`, `webview2-com`, `webview2`, `objc2-web-kit`, `cef` or `tauri`.

### The live run

`spike.live.test.mjs` runs `headless.command` once from the repo root, with `DISPLAY`, `WAYLAND_DISPLAY` and `CI` unset and a 10-minute timeout. It reads libtest's `test <name> ... ok|FAILED|ignored` lines. Every screen's test, the stocks test and the report test must report `ok`, and the command must exit 0. A command that can't start fails with `BLOCKED`.

## How to run

- Public tests, fast and with no build: `node --test tests/acceptance/337/spike.test.mjs`.
- Live tests, which build the app and run its headless tests: `node --test tests/acceptance/337/spike.live.test.mjs`.
- The validator's own tests, which plant wrong spikes in a small temporary git repo: `node --test tests/acceptance/337/validator.test.mjs`. They pass at the base, since they test the tests and not the spike.
- The preflight's `tests/*.test.mjs` pattern doesn't reach this folder.

## Criteria, tests and wrong spikes

IDs are the first 8 hex digits of SHA-256 of each criterion's text, computed with the command from #48's README.

| ID | Criterion | Tests | Wrong spikes it must fail on (planted in `validator.test.mjs`) |
|---|---|---|---|
| `#337.05b344ec` | Both agents' panels load and pass the headless test within two rounds of fixes | public: one panel per agent, each a tracked JS file matching its hash, written from the issue, docs at the merge base, gpui-kit's docs pinned upstream and docs this change adds with their hash (redrafted once), at most two fix rounds, ending in a pass, with the issue's agent-built runtime fields, in the panel host or in process as a declared deviation that the decision admits (redrafted once). Live: each panel's screen test reports `ok` | No Codex panel. Three fix rounds. A last round that failed. A failed round naming no fix. A wrong hash. A missing file. One file credited to both agents. An input from `crates/` or a doc the merge base lacks. An upstream doc on a branch, not a commit. Upstream source code, an example or a test. This repo passed off as upstream. Another agent's panel as an input. A task statement with the wrong hash, untracked, holding a script code block (tagged or not) or copying the other agent's panel. An input of an unknown shape. An agent-built panel `in_process` with no deviation, or claiming `shipped`. JIT on in the panel host. A panel-host panel declaring a deviation. In process: off the UI thread, JIT on but not listed, a listed field it keeps, no reason, no `until`, `decision.agentPanels: panel_host`, a decision claiming the panel host was proven, a decision that never says in process. A 512 MiB heap. A 5 ms update budget. A third agent. A libtest `FAILED`, `ignored` or missing result, or a non-zero exit |
| `#337.9e506bd8` | If any criterion fails, the app falls back to a small native app per platform (Swift on macOS) for the line and the count, with no web view, and extension panels wait for a toolkit that passes; the decision says which | public: `decision.failed` equals the recomputed set. gpui-kit only when it's empty, otherwise native with Swift on macOS and panels waiting. No web view in the decision or `Cargo.lock`. The text gives every number and is in the technical design's toolkit row | gpui-kit though a panel failed, the report never opened, or cold start was 1.2 s. A fallback naming no failed criterion. Native though everything passed. A failure named that didn't fail. Electron on macOS. A fallback that keeps extension panels. `webView: true`. A text without its numbers. A text not in the design. No decision. `wry` in `Cargo.lock` |
| `#337.e2f507ac` | The stocks panel loads from recorded quotes and a report opens in your browser | public: a tracked recorded-quotes file of the shape above, the stocks and report results `pass`, a kept report showing every recorded symbol, and no panel reaching the network or a program. Live: the stocks test and the report test report `ok` | No quotes file. The stocks test failed. The report never opened. No kept report. A report missing a recorded symbol. A panel that calls `fetch` |
| `#337.649cb21e` | Budgets, on the reference Mac in the local preflight, compared with the merge base: the toolkit passes only with cold start under 1 s, idle CPU under 1%, memory under 200 MB and an app under 60 MB, and the local preflight, snapshot renders included, still runs in under 5 minutes | public: five runs per budget on either reference Mac's fingerprint (both count: Mac15,7 with an M3 Pro and 36 GB, or Mac15,12 with an M3 and 16 GB, on mains power, Low Power Mode off, thermal state nominal, a macOS build recorded), a method, a display that matches the worst run, merge-base runs (required for the preflight) or a reason, and no INCONCLUSIVE result. gpui-kit only when all five PASS | gpui-kit with cold start 1.2 s, memory 210 MB, a 61 MB app, idle CPU at exactly 1% or a 5.5-minute preflight. A Mac that is neither reference. The first's model with the second's chip and memory. On battery, Low Power Mode on or the thermal state fair, on either Mac. No macOS build, on either Mac. Four runs. No app size. A display that isn't the worst run. No merge-base preflight. No base runs and no reason. A merge base outside history |

Scope tests, untagged since the trace lane tags only criteria: a session list of at least 1,000 rows and a menu-bar count, each on a screen (planted: 999 rows, no count screen, no count). Every screen rendered, clicked and kept as a distinct PNG, the window and both panels among them, and the count either its own captured screen or declared not captured with its own headless check (redrafted once; planted: a missing, non-PNG or shared snapshot, a screen never clicked, a panel with no screen, no `captured`, the window's or a panel's screen or image as the count's, a count not captured that still names a screen or an image, gives no reason, names no test, reuses a screen's test or asserts nothing, a captured count with a reason, and in the live run an uncaptured count's test that didn't run). The headless command in a preflight lane, with no CI (planted: a command no lane runs, a workflow file). The build time recorded (planted: no time, a display that isn't the time).

## What the base commit has

At the base `0c5e145` there's no `docs/spikes/337/record.json`, so every spike test fails with `no spike record at docs/spikes/337/record.json`: all 9 public tests and all 3 live ones, 12 of 12. `BASE-FAILURE.txt` holds that run. The validator's own tests pass at the base, 110 of 110.

## Assumptions a redraft may revisit

- I picked the record's path, every field name and unit, the libtest-name surface for the headless tests and the recorded-quotes shape.
- "Under" is strict: five runs of exactly 1% idle CPU don't pass. The design's own rule says "within". The pass/fail/INCONCLUSIVE margin is the design's, taken from Every task carries its own budgets.
- I read "the toolkit passes only with" as a gate. A budget that fails, with the decision falling back to native, passes criterion 4's tests, since the record is then right. A budget that's INCONCLUSIVE decides nothing, so it fails criterion 4 until it's re-measured. The preflight's 5 minutes is gated the same way, not required whatever the decision.
- The merge-base comparison is recorded, not gated on a 50% regression margin. The issue gives absolute limits, and the existing perf lane already holds the preflight to `benchmarks/budgets.json`'s margin.
- "If any criterion fails" counts criteria 1, 3 and 4. Criteria 1 and 3 are also required outright, so a native fallback leaves their tests red, and the PR says `Part of #337`.
- **Redraft (once) of the panels' runtime requirement.** The first draft required `panel_host` and refused any agent-built panel `in_process`. That was disputed, and this fresh run of the job, from the issue and the design alone, rules it isn't required for the spike. The issue's acceptance criteria and Proof ask only that both panels "load and pass the headless test", and its Scope says "loaded through gpui-shell". `docs/canvas-primitives.md` lands the panel host "before the first agent-built panel (R2)", and the design's Decided row "Where agent-built panels run" leaves the element-tree cost to "A spike before Add anything (R2)". The issue still links the Fields and their "never in the app's process unless it shipped". So an in-process panel is allowed only when the record declares it as a deviation and the decision text admits it without claiming the panel host was proven. The implementer's claim that gpui-shell at M0 keeps its element-tree materializer crate-private didn't decide this. The ruling rests on the issue and docs alone. No other check changed. This requirement may not be redrafted again.
- **Redraft (once) of the panels' `inputs`.** The first draft accepted only `issue#337` or a `docs/` path at the merge base. That was disputed, and this fresh run of the job, from the issue and the design alone, rules that "from the docs alone" means from documentation and not from code, not from this repo's base docs only. The issue's Scope says each panel is written "from the docs alone, loaded through gpui-shell", and the design's Decided rows rely on gpui-shell's own behavior (its JIT, its 443-node benchmark, about 130 registered components) without the base documenting how to write a gpui-shell panel. The docs that do are gpui-kit's own. A panel also needs a statement of what to build and which ids its headless test clicks, which the base has no doc for. So the record may name gpui-kit's docs upstream, pinned to a full commit, and a doc this change adds, pinned by its hash. What stays refused is anything that isn't a doc: source code, examples, tests, another agent's panel and a reference implementation. The implementer's claim about where the task statement lives didn't decide this, and its contents weren't read. No other check changed. This requirement may not be redrafted again.
- An upstream doc's contents aren't fetched, since the public tests read no network. Its commit pins it and its path must be a doc's, but whether an upstream README holds a whole panel is trusted. A doc this change adds is read: the code-block and copied-line checks are proxies, so a reference implementation pasted as prose, or rewritten line by line, gets past them.
- **Redraft (once) of the menu-bar count's screen.** The first draft required the count to be its own screen with its own distinct PNG. That was disputed, and this fresh run rules from the issue and the design alone. The issue's Scope asks to "render and click every screen headlessly with gpui-kit's test support". That reaches what gpui-kit draws. The design puts the count in the menu bar (the tray on Windows and Linux), an OS surface, and the Decided row lists "the window with a long session list and the menu-bar count" as two things. So the count must be its own screen when gpui-kit draws it. When it's an OS menu-bar item gpui-kit can't capture, the record has to say so (`captured: false`, with why) and name the headless test that checks its value. That record names no image for it, so a duplicate can't pass as the menu bar's. The implementer's account of AppKit and gpui's offscreen renderer didn't decide this; the tests don't verify it, and they trust `reason`. No other check changed. This requirement may not be redrafted again.
- **Redraft (once) of the reference-Mac requirement.** The first draft required the record's `machine` to match one reference Mac, Mac15,7 with an M3 Pro and 36 GB, the only one `docs/technical-design.md` named when it was drafted. After the draft, #608 amended the design to name two reference Macs, adding a 13-inch MacBook Air, Mac15,12 with an M3 and 16 GB, and to say every budget holds on each, so a run on either counts. That was disputed, and this fresh run of the job, from the issue and the design alone, rules that a record on either machine counts. The issue says the budgets are measured "on the reference Mac" without naming one, and the design's The reference Macs paragraph now names both and says a budget set on one is met on the other or it is not met. So `machine` must match either Mac on its `model`, its exact `chip` string and its `memoryBytes`, and on either it still needs mains power, Low Power Mode off, the thermal state nominal and a macOS build; otherwise every budget is INCONCLUSIVE and criterion 4 fails until it's re-measured. The problem names both machines when neither matches and each unmet condition. The implementer's account of which Mac the spike ran on didn't decide this. No other check changed. This requirement may not be redrafted again.
- The tests can't confirm where a panel ran. They trust the record. The decision-text check is a wording proxy: it can't tell an honest sentence from a dishonest one that uses a negation, and it refuses a sentence such as "the panels passed ahead of the panel host". Name the panel host as untested in its own sentence.
- "No display" is enforced only by unsetting `DISPLAY`, `WAYLAND_DISPLAY` and `CI` and refusing a display server in the command. On macOS a test could still reach the window server. The tests trust that gpui-kit's test support doesn't.
- The no-network check reads the panel's source for named calls. It's a proxy for the runtime guarantee, not a proof of it.
- What a screenshot shows isn't checked, only that each is a distinct, valid PNG that its named test renders. A rendered session list with fewer than 1,000 rows is caught only by the spike's own test.
- The scope's "one screen-capture frame with the macOS permission flow" is in the design's Decided row, not in issue #337, so there's no test for it.
- App size is five runs like the others, though a size doesn't vary.
