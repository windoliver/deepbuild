# #1358 hand run with the real launchd

Captured 2026-11-18T06:39Z on macOS 27.2.1 (26B131), Node v24.22.0.

## How the shots were made

The shots are captures of the Terminal window.
- The title bar is cropped off, and the mouse pointer is painted out of a blank corner. Nothing else in the images is edited.
- The run's output went through a `sed` filter before it reached the screen, so `/Users/<user>` and `<checkout>` on screen come from that redaction, not from pixel edits. A `.command` file, opened in Terminal, set the window's title and size (160×50) and then ran: `bash e2e-shots.sh 2>&1 | sed -l -e 's#<clone path>#<checkout>#g' -e 's#<this PR's checkout path>#<checkout>#g' -e 's#/Users/<account>#/Users/<user>#g' -e 's#<account>#<user>#g' | tee e2e-run.log` (committed as `e2e-run.txt`, since the repo ignores `*.log`)`.
- Each `pause` in [e2e-shots.sh](e2e-shots.sh) waited for its screenshot before the screen was cleared.

## Tree under test

The run used `44b879d49`, the fix for #2801 in PR #2803. That tree is not "this PR's base plus the fix". It is main at `d4cef00fb`, plus #2803's four commits. Main at `d4cef00fb` is 76 commits past this PR's base `212f16d09`. Those commits change code the hub runs: `core.ts`, `gate-runner.ts`, `plant.ts` and `shared-runs.ts` in `packages/hub/src`, plus the hub's dependencies `packages/record`, `packages/extension-host` and `packages/checks-command`. #2803's product change is in `service.ts` and `server.ts`; its other commits add tests and evidence. `launch()` and `definition()`, the code #1358 is about, are textually the same in both trees. It was a fresh GitHub clone. `npm ci` and `npm run build --workspaces` ran first at #2803's earlier head `be964f2ef`. Then `44b879d49` was checked out and `npm run build --workspaces` ran again; `be964f2ef..44b879d49` changes only `service.ts` and one test. The machine block prints that commit with the label "PR #2803's head". That label came from this script, and it is out of date: #2803's head has since moved to `8790318e2`. That newer commit changes only `docs/evidence/2801/` (its screenshot and output), so the product code is identical.
- **#1358's fix is not new here.** It was already on main at this PR's base `212f16d09`, in `packages/hub/src/service.ts`: `launch()` checks the `launchctl print` path, and `definition()` sets `HOME: homedir()`. #2803 leaves both alone.
- **#2803 fixes #2801.** On main, `deep hub status` could be refused with a `TypeError` ("reading 'raw'") during hub startup, and could time out on slow health readings. Several earlier runs of this script led here:
  1. Runs on main's code hit the TypeError, and #2801 was filed from them.
  2. A run on #2803's first head, `be964f2ef`, no longer hit the TypeError. But after the kickstart in step 3, `deep hub status` got "no answer within 2000 ms" for tries 1–3 and answered at try 4. That gap led to `44b879d49`.
  3. On `44b879d49` the script ran twice. The first run (load ~145–209) went unattended past its pauses while the disk was briefly full, and it was clean: status answered at try 1 in both steps, and the real home was unchanged. The second run is the one shown here.
- **Nothing from #2803 is committed in this PR.** This PR adds only the blind acceptance suite for #1358 and this evidence.
- **The `deep-hook` binary** was copied from this PR's checkout. It is Rust, and #2803 does not touch it.

## Keeping the real hub safe

- The run uses two throwaway homes under `/Users/Shared/dh1358-e2e-*`. They are outside every temp folder, so the #2203 temp-home guard does not apply.
- The real `gui/501/com.deepbuild.hub` is checked free before the run starts.
- The run signals only the hub of the job it loaded, by PID, and boots out only that job.

## The shots

| Shot | What it shows | Criterion |
|---|---|---|
| [0-precondition.png](0-precondition.png) | The machine, the tree, the load, the label free, and the two homes. | |
| [1-home-a-starts-with-its-home.png](1-home-a-starts-with-its-home.png) | `deep hub start` from home A, with the label free beforehand, loads A's plist: `path` = A's plist, `runs = 1`. The plist's `EnvironmentVariables` carry `HOME` = A, and so does the running hub's environment. `deep hub status` answers at try 1. | #1358.e5fdc397 |
| [2-home-b-refused.png](2-home-b-refused.png) | `deep hub start` from home B, with the label held by A's plist, exits 3. It names A's plist and `launchctl bootout gui/501/com.deepbuild.hub`. A's hub keeps its pid, and `runs` stays at 1. B has no socket and no ledger; it gets only an empty `logs` folder and its own unloaded plist (see Notes). | #1358.a5dca18a |
| [3-own-job-kickstarted.png](3-own-job-kickstarted.png) | A's hub is stopped by PID: the job stays loaded and not running, and the socket is gone. `deep hub start` from A exits 0 and the job runs again: `runs = 2`, new pid. The new hub answers `deep hub status` at try 1, has `HOME` = A, and logs its ready line. | #1358.1077c231 |
| [4-cleanup.png](4-cleanup.png) | This run's job is booted out, and the label is free again. Neither of the run's hub pids is running. The real home's hub files are unchanged. `test -e` shows the run's folder is gone. | |

No step printed an error. Every `deep hub status` answered on its first try.

## Notes

- **Load.** The load average was 18/25/78. Other sessions' builds keep this Mac busy. Each step waits for the hub to answer instead of timing out; this time no wait was needed.
- **The bootstrap and the kickstart are inferred, not printed.** `deep hub start` does not echo the `launchctl` calls it makes.
  - Step 1: the label was free, and afterwards the loaded `path` is A's plist with `runs = 1`.
  - Step 3: with the job loaded from A's own plist, `bootstrap` fails. The loaded path matches A's plist, so `launch()` runs `kickstart` (service.ts:240–246 in the tested clone; 229–235 at the base `212f16d09`). `runs` going from 1 to 2, with a new pid, is launchd's record of that start. This hand run cannot tell a kickstart from any other start. The acceptance test `#1358.1077c231` proves the `kickstart` call itself, through its launchctl stand-in's log.
- **B's refused start still writes a plist.** It writes B's own `~/Library/LaunchAgents/com.deepbuild.hub.plist`, plus an empty `.deepbuild/logs`, because `startHub` creates the logs folder (service.ts:315 in the clone) and `startService` (service.ts:267–271 in the clone; 256–260 at the base) writes the definition before `launch()` hands it to launchd. That plist sits in B's home and is never loaded. Criterion #1358.a5dca18a is about what starts, and nothing does.
- **What the cleanup checks.**
  - "None is running" covers only the two hub pids that launchd reported. The screen does not check for helper processes the hub may have started.
  - "Unchanged" covers the listed real-home entries: `hub.sock`, `ledger.db`, `control.token`, `hub.state`, the LaunchAgents plist, and the evidence count.
- **The systemd half of #1358.e5fdc397 was not run by hand here.** Two other runs cover it, both by the implementing session on a Linux machine:
  - `node scripts/proof.mjs before` read `PASS before` for `systemd.test.ts`: it failed on the `as-reported` twin at its assertion. Its output is quoted in the PR description and is not committed, because it names that machine's paths. On Linux, the three launchd tests read INCONCLUSIVE (platform), so the trace there is `Part of`. The Mac lanes ran the launchd tests.
  - `tests/acceptance/1358/LINUX-RUN.txt` is a separate plain `vitest run` with each twin's `service.ts` laid over by hand. It shows the base passing and the `as-reported` twin failing at systemd.test.ts:25.
  - The suite README's "Did not run: `systemd.test.ts` on Linux" (line 173) is the blind drafting job's account of its own macOS run. LINUX-RUN.txt was added after it, by the implementing session.
  - Acceptance files are not edited, so that line stays as the job wrote it.

[e2e-run.txt](e2e-run.txt) is the run's full output. It is the `tee` file with one further edit: the five clear-screen escape sequences (`ESC[2J ESC[3J ESC[H`) that `pause` printed are stripped; nothing else changed. [hub-a.txt](hub-a.txt) is A's hub log, which the cleanup copied: just the two ready lines. In the committed script, the checkout path is redacted to `WT='<checkout>'` (quoted so the script parses). Set it to a built checkout before running.
