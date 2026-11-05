# Acceptance tests for #994: app notifications survive a late hub, run once per user, and say when macOS won't show them

Written blind at base commit `58862789` ("Merge pull request #1315 …"), from the issue, the design doc and the base
alone, before any implementation. Per AGENTS.md the implementing agent doesn't edit them; a dispute goes to a blind
redraft by this job.

## What was read

- Issue #994 as given to this job: the problem, its four Scope lines, AC1–AC5, Proof, "Depends on #326 and #883", and
  the owner's comment (#1146: an idle notifier tick reads nothing; the notifier's posts and withdrawals are unchanged).
- `docs/technical-design.md`: "An ask, and your answer getting back" (every ask ends; no ask reaches its deadline
  unseen), "First-party extensions that ship on by default", the `view` row (one count, a notification's rules, only one
  device plays a sound), the app and trusted-ring rows near the top, "Health reads the agent's side" (doctor items, not
  checked is never ok), the reference window, Dogfooding.
- The base: `crates/deep-app/src/{main.rs,notify.rs,record.rs,hub.rs,views.rs,lib.rs,setup.rs,shown.rs}`,
  `crates/deep-replica/src/{replica.rs,lib.rs,main.rs,shell.rs,snapshot.rs}`, `packages/hub/src/{doctor.ts,server.ts,plant.ts}`,
  `packages/asks/src/index.ts` (`away`, `moveDeadline`, `duration`), `scripts/app-bundle`, gpui's macOS
  `system_notifications.rs`.
- The earlier blind suites' forms: `tests/acceptance/883` (replica, virtual clock, `mod surface`), `27` (hub, stand-in
  Claude Code, deep_ask), `1002` (`deep-replica --first-screen`, the taste call), `483` (INCONCLUSIVE until a call).

## The surface (my choice, since the issue names only `app.notifications`)

Two things can't be real in a test, and both stand in at a boundary we don't own or can't drive: the OS's notification
setting (no test may change System Settings, and an unbundled binary has no notification center), and, in the replica
only, a hub that stops answering. Everything else is the real app, the real hub and the real doctor.

Used as they are at the base: `deep-app` in its window mode, its stderr lines `first-frame-ms …` and
`deep-app: notified <session> <ask>`; `deep hub run`; `test.clock`; `deep doctor --json`; `deep-replica --first-screen`;
`Replica::{open, append, advance, now, notifications, delivered, open_asks, window}`, `Posted`, `repo_root`.

### New in the app

| Surface | Exactly |
|---|---|
| The setting's stand-in | The env var `DEEP_APP_NOTIFICATION_SETTING`, one of `allowed`, `denied`, `alerts_none`. Set, the app takes it in place of the OS's answer at every read. Only tests set it. Unset, the app reads the OS. |
| What the app logs | With the setting off, for each ask it would have posted, on stderr, one line: `deep-app: not notified <session> <ask>: <the setting>`, and never `deep-app: notified <session> <ask>` |
| A second launch | The first process logs exactly `deep-app: brought forward`. The second exits 0, and runs no notifier |
| "One app per user" | One app per `$HOME`: the claim lives under `~/.deepbuild`, as everything of the app's does. So a test's app never meets your own running DeepBuild, parallel runs don't meet, and two homes make two apps |
| The hub's socket while it can't be read | Connections on the schedule the issue names, and no others: every 2 s, then every 30 s after a minute. Connections within 400 ms of each other count as one attempt |
| The window's count | Drawn in the app's first screen, so `deep-replica --first-screen` shows it for a home with no hub: a node reading `hub isn't answering` (or `hub … not answering`) |
| A planted wrong program | The cargo feature `plant-posts-unchecked` on `deep-app`, in no shipped build: it posts and logs `notified` without checking the setting, reading `DEEP_APP_NOTIFICATION_SETTING` as usual |
| In `deep_app::notify` | `#[derive(Clone, Copy)] pub enum NotificationSetting { Allowed, Denied, AlertsNone }` |

### New on `deep_replica::Replica`

```rust
impl Replica {
    /// What the OS answers from now on when `device`'s app reads the setting; it hasn't read it yet. `Allowed` until set.
    pub fn set_notification_setting(&mut self, device: usize, setting: NotificationSetting);
    /// `device`'s app becomes active, so it reads the setting.
    pub fn activate(&mut self, device: usize);
    /// `device`'s window shows `view` in its center: "home", "needs-you" or "session". `window()` then draws device 0's.
    pub fn show_view(&mut self, device: usize, view: &str);
    /// Every read of the hub fails from now on, as with no socket answering.
    pub fn hub_stops(&mut self);
    /// Every poll of the hub comes back refused (`HubError::Refused`) from now on.
    pub fn hub_refuses(&mut self);
    /// The hub answers again.
    pub fn hub_answers(&mut self);
    /// Writes `device`'s window to `path` as a PNG, at the reference window.
    pub fn screenshot(&mut self, device: usize, path: &Path);
}
```

The cases give the virtual clock 3 s after a change before reading the window, so a 2 s retry has run.

### New on the hub

- **`notifications.report`**, app role only. Params `{ "setting": "allowed" | "denied" | "alerts_none" }`, the app's
  latest reading; any result. The app sends it when it connects and when its reading changes. It stands until the next
  report; the tests hold their connection open, so what a closed connection does is left to the implementer.
- **`deep doctor`'s `app.notifications`**, agent `deepbuild`: `level: "fail"` with `deep doctor` exiting 1 for `denied` and
  `alerts_none`; the text of `evidence` and `fix` together names the setting, `Allow notifications` for denied and
  `Alert style` for alerts set to none; `fix` names `System Settings`. `level: "ok"` for `allowed`. With no reading, never
  `ok`. The code is the implementer's.
- **The deadline**: with `denied`, an open ask no window showed doesn't take its default when the hub's clock passes its
  deadline; once `allowed` is reported and its wait has passed, it does.

### The words the judges read

Row: `not notified`. Count, lowercased: `notifications` and `off` and `system settings`; or `alerts` and `none` and
`system settings`; or `hub` and `isn't answering` / `not answering`. The count is read as any node of the Home view.

## How the tests see each thing

- **A late hub (AC1).** `deep setup` in a temp home, the hub stopped, the real app started, 20 s, `deep hub run`, 5 s,
  then a session of the Claude Code stand-in calls `deep_ask` through its own `deep mcp`. The judge reads the app's log: a
  `notified` line for that ask within 2 s of the record's `ask.created` (`NOTIFY_AFTER`, the 250 ms tick and the pipe).
  Late on a machine with a 1-minute load above half its cores is `INCONCLUSIVE`, never a pass; never is a failure.
- **The retry schedule (Scope).** The real app, and a socket at `~/.deepbuild/hub.sock` that takes each connection and
  hangs up, noting when, with a `control.token` left beside it, since the reader reads that first. 100 s of wall time
  from the first attempt.
- **A second launch (AC2).** Two real processes in one `$HOME`. The judge counts `notified` lines for the ask across both
  logs; the base's two notifiers post twice, and fail there.
- **The planted second notifier (AC2).** A second real app in a second home whose `config.json` and `control.token`
  point at the same hub: one app per home, so it runs, a true second notifier on one hub, through the same judge. It
  needs no plant in the app.
- **Denied (AC3).** The real app with `DEEP_APP_NOTIFICATION_SETTING=denied`: its log, and the real `deep doctor` it fed
  through the real hub. `hub.test.ts` drives the doctor alone from a connection that says hello as the app, so the
  doctor's path is proved with no app built. The row is drawn by the replica (`window.rs`).
- **Sound (AC4).** `Posted.sound` on the replica's virtual clock, the notifier's own output.
- **The deadline (Scope).** `deadline-redraft/`: the hub's test clock (`DEEP_HUB_TEST_CLOCK_STEPS=1`) steps in rounds until the default comes.
- **AC5.** `taste.test.ts`. See The taste call.

## Fixtures

`fixtures/four-sessions.events.jsonl`: four sessions, each with its task, nothing asked (`session.start`, `task.created`, in
the shape of #883's fixture). The asks are built in `common.rs` from #883's `ask.created@4` template. The hub tests use
no fixture: every ask goes through `deep_ask` on a real hub. `helpers.ts` imports #27's helpers rather than copy them.

## How to run

With Node 24.22 first on `PATH`, the workspaces built (`npm ci; npm run build --workspaces`) and cargo on `PATH`:

```sh
cargo test --locked -p deep-replica --test acceptance_994_sound     # AC4, Scope: sound
cargo test --locked -p deep-replica --test acceptance_994_window    # AC3's row, Scope: the count
npx vitest run --root tests/acceptance/994 --no-file-parallelism hub.test    # AC3's doctor
npx vitest run --root tests/acceptance/994 --no-file-parallelism deadline-redraft    # Scope: the deadline
npx vitest run --root tests/acceptance/994 --no-file-parallelism app.test    # AC1, AC2, AC3 on real processes
DA994_SCREENS=<dir> DA994_NOTIFICATION=1 npx vitest run --root tests/acceptance/994 --no-file-parallelism taste.test    # AC5
npx tsc -p tests/acceptance/994/tsconfig.json
```

- One `[[test]]` entry per Rust target in `crates/deep-replica/Cargo.toml`, `harness = false`, as the replica's suites. A
  filter naming no case exits 1; off macOS each target prints INCONCLUSIVE and exits 1; every macOS-only vitest test fails
  `BLOCKED` elsewhere.
- `app.test.ts` opens real windows on your screen, and they take focus. It builds `deep-app` itself, and once with
  `--features plant-posts-unchecked`, running a copy of each binary. On the base it took 10 minutes at a load of 70, most
  of it the first test's builds; the scope test on retries takes 100 s by itself. Run it alone: `scripts/lanes.mjs` doesn't
  list it yet, and at a high load AC1's 2 s reads INCONCLUSIVE.
- The hub tests build `deep-hook` as #27's helpers do.
- Every folder is a temp folder removed afterwards, and `HOME` is one for every process, so nothing touches your real
  `~/.deepbuild`. Processes stop by PID only. No model is called and no test reaches the network. `taste.test.ts` with
  `DA994_NOTIFICATION=1` posts one real notification, from `target/DeepBuild.app`.
- With `--root` here, Vitest writes its cache under `tests/acceptance/994/node_modules/`. Delete it before committing.

## Criteria, tests and wrong programs

| Criterion | Tests | Wrong program it fails |
|---|---|---|
| AC1 `#994.1399c6a7`: app 20 s before the hub, an ask 5 s after the hub, notified within the delay | `app.test.ts`, `AC1 … is notified within the notification delay` | The merge base, which never tries again: the failure names the ask (BASE-FAILURE.txt). A notifier that retries every 30 s reaches the hub after the ask opened, so it fails too |
| AC2 `#994.428580db`: launching twice, one ask is notified once | `app.test.ts`, `AC2 launching the app twice …`: one `notified` across both logs, then the second exits 0, the first runs on and logs `brought forward` | `AC2 planted: a second notifier …` through the same judge, which must fail naming the ask with "notified 2 times"; and the merge base |
| AC3 `#994.649376f0`: denied: row, doctor, log | The log and the doctor on the real app: `app.test.ts`, `AC3 the log never says notified …`. The doctor alone: `hub.test.ts`, `AC3 app.notifications fails …`. The row and nothing posted, with an allowed control: `window.rs`, `ac3_with_notifications_denied_…` | `AC3 planted: an app that posts without checking …` (`plant-posts-unchecked`), through the same judge, naming the ask; and the merge base |
| AC4 `#994.857c4868`: ten asks, four sessions, one tick: one sound, four notifications | `sound.rs`, `ac4_ten_asks_…` | The merge base plays ten (BASE-FAILURE.txt). This target compiles and runs on the base as it stands |
| AC5 `#994.f8ef6a91`: shown to you | `taste.test.ts` | Stays INCONCLUSIVE, never PASS, with no recorded call, or one on other screenshots. A call of anything but "looks right" fails |

The issue's Scope, beyond the criteria:

| Scope line | Test | Wrong program |
|---|---|---|
| Every 2 s, then every 30 s after a minute | `app.test.ts`, `scope: the app tries every 2 s …` | The base's one try; a 2 s loop that never slows; a loop that stops at a minute; a 30 s loop from the start |
| The count says the hub isn't answering while it can't read | `window.rs`, `scope_the_count_says_the_hub_isnt_answering_…`, and clears; `app.test.ts`, `scope: with no hub answering …` on the real reader | The base's "0 asks need you" |
| A refused poll is shown the same way | `window.rs`, `scope_a_refused_poll_…` | A poll that throws refusals away, as the base's does |
| One app per user | AC2 | |
| Read at start and when it becomes active | Start: AC3 on the real app. Active: `window.rs`, `scope_the_app_reads_the_setting_again_…`, both ways | An app that reads once |
| Off or alerts none: the count says so with the fix | `window.rs`, `scope_the_count_says_…`, `scope_alerts_set_to_none_…` | |
| `deep doctor` for alerts set to none | `hub.test.ts` | A doctor that knows only denied |
| Its deadline counts only time it was seen | `deadline-redraft/deadline.test.ts`, the blind redraft swapped in on the owner's call, Nov 5: the first draft's single step past the deadline raced the ask's first showing and its minimum notice | Its README |
| Asks due within 2 s play one sound | `sound.rs`, `scope_asks_due_within_2_s_…`: due 1.5 s apart share one, due 3.5 s later plays its own | The base's one each; a notifier that sounds once and never again |
| Each session keeps one notification | AC4 | |

## The taste call

`taste.test.ts` takes three screenshots: `hub-not-answering.png` (`deep-replica --first-screen`, for a set-up home with the
hub stopped), `not-notified-row.png` (the replica's Needs you, `window.rs` under `DA994_SCREENS`), both checked at
3024 × 1964, and `notification.png` (`screencapture` of the display while the real bundle's notification is held, confirmed
through `--notification-center`, only with `DA994_NOTIFICATION=1`). Without that variable, or with macOS not letting the
bundle notify, the run stops INCONCLUSIVE. Whether they look right is yours, recorded in `docs/evidence/994/taste.json`:

```json
{ "criterion": "#994.f8ef6a91", "call": "looks right", "by": "<who>", "at": "<date>",
  "screens": { "hub-not-answering.png": "<sha256>", "not-notified-row.png": "<sha256>", "notification.png": "<sha256>" } }
```

No test reads a picture to judge it.

## What the base has

`BASE-FAILURE.txt` holds the runs at `58862789`. In short: at the base the app gives up on a late hub, two launches post
twice, a denied app logs notified, and ten asks play ten sounds. The AC4 target and the real-process tests run there
and fail at their named judges. `AC2 planted` passes there, which is the wrong program failing its judge.
`acceptance_994_window` doesn't compile, and every error is in its `mod surface`, so none of its cases has run.
`hub.test.ts` fails at the first `notifications.report`. The planted AC3 run is `BLOCKED` there, since the base has no
feature: the base is that wrong program, and fails the plain AC3 test. `taste.test.ts` stops at its first screenshot, so
its INCONCLUSIVE ends haven't run yet.

## What can't be proved here

- **The real OS read.** No test proves `getNotificationSettings` reads `denied` or alert style none on a real Mac, since none
  may change System Settings. `DEEP_APP_NOTIFICATION_SETTING` stands in for it. Only the AC5 bundle run touches the OS's
  answer, and only as allowed.
- **A sound on the real Mac.** At the base `SystemNotification` has no sound field and gpui's macOS `show` sets none, so the
  real app's posts play nothing the notifier asks for. "One sound" is judged on `Posted.sound`, the notifier's output. If
  the fix adds a real sound path, no test here hears it.
- **The real window's rows.** The real `deep-app` window is #337's `Spike`: its "N waiting on you" counts fixture sessions
  and it draws no Needs you rows. So the row and the count are read in the replica's shell, and in `--first-screen`.
- **"Brought forward".** The test reads the first app's log line, never which window macOS has in front.

## Assumptions a redraft may revisit

- `notifications.report` and its words, and the env var, are this job's names. The issue names neither; the hub needs the
  reading for the doctor and the deadline.
- **"Seen".** The issue names no signal for it. A window that shows the ask's row could report it, through `views.shown` or
  otherwise, so this suite pins only the two ends: unseen and off holds, allowed again ends. A real window in a test
  never draws the row, so nothing here tests time counted while seen with notifications off.
- "Within 2 s of each other" is read as the gap between due times. A chain of asks each under 2 s from the last is left
  open: the case uses gaps of 1.5 s and 3.5 s, and the exact 2 s isn't tried.
- A refused poll "counted" is read as counted among the reads that failed, so the count says the hub isn't answering.
- "Naming the setting" is read as the words macOS uses: `Allow notifications` and `Alert style`.
- 2 s as the notification delay for a real process, and 400 ms as one attempt, are this job's margins.
- `not determined` (macOS hasn't asked yet) isn't named by the issue, so nothing here says what the app does with it.
- `ask.defaulted` is the end judged by the deadline test, as #27's and #908's are.
