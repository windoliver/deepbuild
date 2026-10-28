# #23 permissions/: permission prompts and standing rules

Seven of #23's criteria, written first and blind by a job that never saw an implementation of #23. They extend the shared surface in `../README.md` (its "The surface" and "How the later jobs reach the rest, `permissions/`") only as this section says. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft by this job.

Sources:

- **The issue**, its text as of October 28, 2026: Scope (permission prompts, typed approvals, allow/deny/cancel for the call or the session, never the agent's "always allow"), the 23 criteria, Proof, References (Claude Code's hooks page: PermissionRequest can allow or deny) and Depends on.
- **The design**, `docs/technical-design.md`: the resolver-decisions row of First-party extensions that ship on by default; An ask, and your answer getting back (Every ask ends, Asks stay current, the closed outcomes); Before each command (rules.json, `fail_closed`, a cloud resource the plan doesn't name, the hub down); Hooks are evidence, not a state machine; the adapter paragraph on permission requests ("A permission request has a kind … never picks an agent's option that writes a lasting rule into the agent's own settings"); Decision and rule; Decided, "Answers typed in a session"; Tests written first; Wrong programs.
- **The base**: `origin/main` at `dd3ff94c` (it moved past the shared README's `debda22` when #321 merged; nothing of #23 is in it). Code read: `packages/hub/src` (`server.ts`'s hook handling and `reply`, `holds.ts`, `hookmap.ts`, `guards.ts`, `core.ts`'s `answer`, `confirm.ts`, `plant.ts`, `claude-settings.ts`), `packages/asks` (the resolver gate, `sources.json`'s `permission.request` row), `packages/adapters` (`PermissionAnswer`, the Claude Code `permissionReply`), `packages/contracts/schemas/permission.answer@1.json`, `crates/deep-hook` (`main.rs`'s floor with the hub away, `matcher.rs`'s `effect:` classes), `adapters/claude-code.facts.json` (`hookTimeouts`) and its corpus.
- **Sibling suites, for their conventions**: tests/acceptance/321 (whose helpers these adapt), 304, 24, 18, 25 and `../match`.

## Run

With Node 24.22 first on `PATH` and the Rust toolchain, from the checkout's root:

```sh
npm ci                                       # once
npm run build --workspaces                   # the hub and the deep CLI the tests start
cargo build --locked -q -p deep-hook         # target/debug/deep-hook, which every hook runs
npx vitest run tests/acceptance/23/permissions --no-file-parallelism
npx tsc -p tests/acceptance/23
```

- Each test starts hubs of its own; the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list beside #321's and #304's. The implementer adds it.
- Temp folders are `/tmp/dh23p-*` (a Unix socket path must fit in 104 bytes). `HOME` is `<tmp>/h` for every process; the real `~/.deepbuild`, `~/.claude`, `~/.aws` are never touched. Processes are stopped by PID only.
- No network, no model, no `claude` or `aws` binary. The OS confirmation is the #24 stub (`DEEP_HUB_TEST_CONFIRM`), never Touch ID.
- Each hub test takes 20 s to 2 minutes on a correct program; the plant tests run the same scenarios again.

## The surface these tests add

The tests reach DeepBuild through deep-hook (`deep-hook claude-code <event>`, payloads shaped like the corpus's, each session's hooks children of that session's own process, `fixtures/agent.mjs` from #321), `deep hub run` with `DEEP_HUB_TEST_CLOCK`, `DEEP_HUB_TEST_CONFIRM` and `DEEP_HUB_PLANT`, the socket's `events.read`, `deep inbox answer <ask> <option>`, the shipped adapter registry (`shipped().get('claude').permissionReply`), and files under `HOME`. On top of the shared surface:

1. **A permission prompt is answered through the hook only from a saved decision.** A Claude Code `PermissionRequest` that a saved decision covers is answered from it through the adapter's `permissionReply` and logged as decided for you (`decision.applied` citing it). One no decision covers opens no ask: DeepBuild's entry exits 0 within Claude Code's hook timeout (the facts' `hookTimeouts`: 60 s) with no decision, never a deny or an allow, so Claude Code draws its own prompt and you answer it there (design: Threats, "Agents driving other agents' terminals"; How we know version 0 works, "Living next to other tools"; #18 AC19).
2. **Offered back in the CLI.** Once the call you typed yes to has run (its PostToolUse), the hub offers that permission back as a decision: `deep inbox` lists it on a line of its own whose first word is the offer's handle (never an `ask:` handle), naming the command and the scope it would be saved at (`repo:<…>`). It is not an ask: no `ask.*` event, no row in `inbox.read`'s asks. `deep inbox save <offer>` is the one click: on the trusted path, once the OS confirms you, it saves exactly one decision (`decision.created`) for the repo, exit 0. Nothing typed saves one.
3. **`PermissionAnswer`** (packages/adapters) gains `decision: 'allow' | 'deny' | 'cancel' | 'none'` and `for: 'call' | 'session'`, as `permission.answer@1` has them. The Claude Code adapter's reply is: allow → `decision.behavior: 'allow'`, with `updatedPermissions` only for the `session` destination if any; deny → `behavior: 'deny'`; cancel → no `decision` at all, so Claude Code's own dialog shows. Never `deny`, never `allow`, for cancel.
4. **Standing rules at PreToolUse.** With the hub up, a call deep-hook matches to `effect:dependency` or `effect:cloud-resource` is decided after the guards and the session's permission mode:
   - covered by a saved decision: its answer. For yes, Claude Code's explicit allow (`permissionDecision: 'allow'`), or a pass whose permission prompt (1) is then answered allow; never the explicit allow when the payload's `permission_mode` is `dontAsk` or `plan`. For no, a deny. What the agent reads cites the decision's handle `decision:<id>` (`additionalContext` for a yes; stderr, `permissionDecisionReason` or the deny's message for a no). Logged as `decision.applied` citing it, nothing shown in a batch.
   - not covered: an authority ask whose question names the package (dependency) or the account's ID or profile (cloud), and the call denied, what the agent reads naming the ask's handle. That ask waits for you; it isn't cancelled when the hook ends.
5. **Accounts.** A command names its AWS account by `--profile <name>`, whose section in `~/.aws/config` names `sso_account_id`.
6. **rules.json.** The hub copies a standing rule for a cloud resource into `~/.deepbuild/rules.json` (shape the implementer's, keeping every guard entry); deep-hook, with the hub stopped, lets a call that rule covers through (and spools it, so the hub records it on its return) and still denies one no rule names with the shipped entry's reason.
7. **Planted programs** the hub selects with `DEEP_HUB_PLANT` (the implementer adds each to `packages/hub/src/plant.ts`): `permission-always-allow`, `typed-saves-decision`, `decision-over-mode`, `decision-before-guard`, `rule-without-reason`, `copies-no-standing-rules` (what each does: `plants.ts`).

### World

`helpers.ts`, `makeWorld`: rules.json is the shipped default guards plus one guard of yours, `no-kms-lockout-bypass` (`run:aws kms create-key --bypass-policy-lockout-safety-check`, block, not `fail_closed`), with its planted call and twin (checked against deep-hook's check mode). Claude Code's five settings files each exist with rules of yours: `~/.claude/settings.json`, `~/.claude/settings.local.json`, `<repo>/.claude/settings.json`, `<repo>/.claude/settings.local.json`, `~/.claude.json`. `~/.aws/config` names `shop-prod` (account 111122223333) and `shop-new` (444455556666). Every hub's clock starts at Monday 2 November 2026 09:00 UTC. Your ask settings are #321's (authority deadline 1 day, no batch).

### Playing Claude Code

The test fires each hook as Claude Code would: a PreToolUse first, then, when it passes the call on, the PermissionRequest, offering Claude Code's own "always allow" option in `permission_suggestions` (a rule for the local settings file). When DeepBuild gives no decision, Claude Code draws its own prompt; the person types yes there (not "don't ask again"), and the call runs: its PostToolUse. When a reply carries `updatedPermissions`, the test applies them the way Claude Code does: an entry for the session is written nowhere; one for `userSettings`, `projectSettings` or `localSettings` is written into that file.

### Late hooks

deep-hook gives the hub 20 ms to acknowledge and ends a hook on its own near 50 ms; on a loaded Mac the hub then never decides it. A reading is INCONCLUSIVE (a skip, never a pass) when deep-hook says it spooled the call or denied it on the floor "while the hub doesn't answer", the spool holds it marked late, the record marks its call late, or a hook that needed the hub's answer ended with nothing said between 45 ms and 2 s, which is how deep-hook's watchdog ends one. Each skip names the load average.

## Readings where the issue leaves a choice

- **A cancelled permission ask, at the hub, isn't reachable at R1.** A prompt no decision covers opens no ask (surface 1), and one a decision covers is answered at once, so with Claude Code no permission ask stays open for a hook to be told it was cancelled. A request spooled while the hub was down "still becomes an ask you see" (design, the hook protocol), but its hook ended long before. So 02482c32 is proven where the cancel is made into a reply: the Claude Code adapter's `permissionReply` for an answer whose decision is cancel (`adapter.test.ts`). The hub's reply to a prompt it has no answer for is also checked never to be a deny (`answeredInTerminal`, in `week` and `typed`).
- **"For that call or that session only"** is read through Claude Code's reply: `updatedPermissions` only for the `session` destination. "The agent's settings files are byte-identical" is the five files above, compared by SHA-256 before the first prompt and after the seventh day, Claude Code having applied every reply.
- **"A week of answers"** is seven days on the hub's test clock: the hub restarted each morning (its clock moves with real time from where the test starts it), one new session a day, the same prompt answered from the decision you saved on day one.
- **"The plan doesn't name"**: plans land at R2 and the base has none to name a package or a resource, so the sessions run with no plan, and the plan names nothing.
- **"The agent sees the reason"** is checked as what the agent reads citing the decision that answered (`decision:<id>`), the reason the Scope requires every automatic answer to carry; "sees why" for an ask is its handle.
- **"The session's permission mode would deny"**: `dontAsk` (the mode DeepBuild's own read-only jobs launch with, in the facts) and `plan`. Claude Code's explicit PreToolUse allow skips its permission system, so in those modes a saved decision must not give it. A pass, or a deny, holds.
- **"A guard would deny"** uses your guard in block mode, matched by deep-hook, against a call your standing rule otherwise allows.
- **"An approval typed in the chat"** is read as both the yes you type on the agent's own prompt and words you type in the session ("always allow it here"); neither saves a decision. **"Offered back in the app or the CLI as a decision with its kind and scope"** is the `deep inbox` line naming the command and `repo:…`, and **"one click"** is one `deep inbox save` with the OS confirming you; the app isn't reachable from these tests. Before the click, the same prompt in another session still reaches you in the agent's own prompt.
- **Codex** has no `permissionReply` at the base; only Claude Code's is tested.
- **The copy into rules.json** is waited for up to 30 s by the account's ID or profile appearing in the file, never failed on: the calls with the hub stopped judge it, as the criterion says.
- **Repo scope across sessions.** Every session of a test works in one repository folder, so a decision saved for its repo covers the next session there. At the base the hub saves an answer for the ask event's project, which hook-raised asks don't carry; covering a later session needs the repo.

## Criteria, tests and wrong programs

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed and the leading `- [ ] ` dropped (`tests/acceptance/48/README.md`). Each test name starts with its ID.

| ID | Criterion (short) | Tests | Wrong programs it fails on | On the base |
|---|---|---|---|---|
| `#23.7232c832` | answered for the call or the session only; settings files byte-identical after a week | `week.test.ts` | plant `permission-always-allow` (names `updatedPermissions addRules for localSettings`); a hub that writes any settings file; a hub that asks for an uncovered prompt or denies it; a do-nothing hub (nothing offered back) | fails: nothing offered back |
| `#23.02482c32` | a cancelled ask's prompt gets cancel, never deny | `adapter.test.ts` | the adapter that maps cancel to deny (`plants.ts`, as the base's does); an adapter that answers nothing (its allow and deny checked too) | fails (`{"behavior":"deny"}`) |
| `#23.3b29ddde` | a typed approval is saved only after one click | `typed.test.ts` | plant `typed-saves-decision` (names the decision saved before the click); a click that saves none or two; a decision saved outside the repo | fails: nothing offered back |
| `#23.15c1cac3` | a saved decision never allows what the mode or a guard denies | `mode-guard.test.ts` | plants `decision-over-mode` (names `dontAsk`), `decision-before-guard` (names `no-kms-lockout-bypass`) | fails: the KMS key isn't asked (the base blocks it outright) |
| `#23.56633035` | `npm install` of an unnamed package answered by the standing rule, with its reason | `dependency.test.ts` | plant `rule-without-reason`; a hub that lets new packages through unasked (the base) | fails: `npm install left-pad` let through unasked |
| `#23.e3e9bdfd` | a cloud resource the plan doesn't name: your rule or asked, the agent told why | `cloud.test.ts` | plant `rule-without-reason`; a hub that denies outright with no ask (the base) | fails: denied with no ask |
| `#23.1e4ae1da` | hub stopped: the copied rule allows and records account A; account B still denied with the reason | `hub-down.test.ts` | plant `copies-no-standing-rules` (names account 111122223333 denied) | fails: the KMS key isn't asked |

## Files

- `helpers.ts`: the world, the hub, the record, sessions and hooks, reading replies, Claude Code applying `updatedPermissions`, late hooks, your answer.
- `scenarios.ts`: each criterion's scenario, and the adapter's (`cancelGetsCancel`).
- `week.test.ts`, `adapter.test.ts`, `typed.test.ts`, `mode-guard.test.ts`, `dependency.test.ts`, `cloud.test.ts`, `hub-down.test.ts`: one per criterion.
- `plants.ts`, `plants.test.ts`: the wrong programs and the failures they must produce.
- `fixtures/agent.mjs`: one session's Claude Code, from tests/acceptance/321 (same repo, same license).
- `BASE-FAILURE.txt`: the base, the do-nothing program, the plants and the sample fix.

## Disputes

- **October 28, 2026: #18 AC19 (`#18.a57c35bb`, `tests/acceptance/18/install/coexist.test.ts`).** The first draft held every Claude Code permission prompt no decision covered for an authority ask, answered it from `deep inbox answer`, and cancelled the ask at the hold's end. #18 AC19 requires that a prompt the person answers by typing in the terminal opens no ask (no `ask.*` event, no inbox row) and that DeepBuild's entry exits 0 in time, and the design says the same twice (Threats, "Agents driving other agents' terminals": "DeepBuild answers through hooks before any prompt is drawn, records a prompt that was answered in the terminal with no ask behind it"; How we know version 0 works: "a permission prompt answered by typing shows up as answered without an ask"). The design's one other line, that "a permission request spooled while the hub was down still becomes an ask you see", is about requests the hub never saw live, not prompts it saw and left to you. #18 AC19 stands; this suite was redrafted blind: surface 1 and 2 above, `week` and `typed` now start from a prompt answered in the terminal and offered back, the hub-level cancel test and the `cancel-as-deny` plant are gone (02482c32 is proven at the adapter, reading above), and `typed-saves-decision` now saves the typed yes. The redrafted sample fix passes #18 AC19 too (BASE-FAILURE.txt).
