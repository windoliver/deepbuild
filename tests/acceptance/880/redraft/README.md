# Blind redraft of #880's Touch ID test (`#880.e0afc5f5`)

Written blind from issue #880, `docs/technical-design.md` ("The trusted path is a device you paired", the row "Answers from the terminal", "An ask, and your answer getting back") and the base `0f7fb686`, reusing this suite's `../helpers.ts` and its copy-of-the-hub rig (`../README.md`). The criterion: "On the reference Mac, a manual run: Touch ID accepted gives a counted answer within 2 s of the touch; Touch ID cancelled leaves the ask open with "the prompt was cancelled"". Proof: the manual run, recorded as a screen capture.

## The manual run

On a reference Mac (Mac15,7 or Mac15,12) with Touch ID enrolled, from the checkout's root, after `npm run build --workspaces` (which builds the real `packages/hub/dist/deep-confirm`):

1. Start a screen recording of the whole screen (Shift-Cmd-5) with the terminal showing.
2. Run:

   ```sh
   PATH=$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH \
   DEEP_880_TOUCH_ID=1 npx vitest run tests/acceptance/880/redraft/touch-id.test.ts --reporter=verbose
   ```

3. Touch nothing until the terminal says `TOUCH THE SENSOR`. It says so (with a bell) the moment the hub starts `deep-confirm`; touch as soon as the panel shows.
4. Then it says `press CANCEL`; press Cancel on the panel, without touching the sensor.
5. At `Done`, stop the recording and keep it with the test's output.

Each step waits up to 10 minutes for you. Setup may take a minute or more on a loaded Mac. The test home's Secure Enclave key stays wherever the shipped helper keeps it. Without `DEEP_880_TOUCH_ID=1`, or off a reference Mac, the test is skipped as INCONCLUSIVE, never passed.

## What it checks and how it measures

- **Accepted:** the hub ran `deep-confirm`, `deep inbox answer <ask> approve` exits 0, the ask is answered once (`approve`, via the inbox), and touch-to-counted is at most 2000 ms.
- **Cancelled:** the hub ran `deep-confirm`, the command exits 3, its output contains `the prompt was cancelled`, and the ask stays open with no decision saved.

**The touch.** The helper takes the touch, signs and exits, so its exit is the latest moment of the touch the hub can see. A small watcher (C source in the test, built with `cc` into `/tmp/dh880-*`) finds the helper among the hub's descendants (`proc_listpids`, by path or name) and among this user's processes (by exact path), and reads its exit time from the kernel: `kqueue` `NOTE_EXIT`, and the exit time the kernel keeps in the process's rusage (`exact` in the output) when it can still read it. No `ps`, no output that grows with the number of processes, and the watcher's own scheduling delay never moves the touch later than the helper's real exit.

**The count.** The hub's own `ts` on the `ask.answered` event, read through `events.read`. It is used when it falls between 250 ms before the helper's exit (the hub may record the reply it read while the helper finishes exiting) and the command's exit; otherwise the command's exit is used, which only makes the check stricter. The output prints the panel's start, the helper's exit, the hub's record and the command's exit, so the screen capture can be lined up with them.

**What it can't see.** The time between the touch and the helper's exit (the enclave's signing) is outside the measured interval; the screen capture covers it. If the helper is still running 5 s after the command exits, the test stops with `INCONCLUSIVE` rather than guessing a touch time. A watcher that can't be built or started stops the test `BLOCKED`. Processes are stopped by PID only: the watcher exits when its stdin closes, and `cleanup` stops everything the suite started.

## Verified, and not

- `npx tsc -p tests/acceptance/880`: no errors.
- Without the opt-in: skipped, `INCONCLUSIVE: a manual run on the reference Mac; …`.
- The watcher, built from the test's source, on a stand-in binary named `deep-confirm` (a child, and a grandchild through `sh`): it reported both starts and both exits as `exact`, 1–3 ms before the parent saw them, at load average 40–60, using about 6% of one core.
- Not run: the opt-in path, against any hub. It shows Touch ID, so a person must run it.
