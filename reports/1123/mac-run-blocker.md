# Mac full-unit reading: blocked by an existing real-window benchmark

Required host is Mac; Spark is optional by the owner's decision. This records the actual full run, not the earlier no-grant attempts.

## What ran

- One owned timed grant admitted the full before/after pair on 2026-11-12, at load about 8 on 18 cores.
- Both sides pinned the same source/test commit `63e11e81a`; only the recorded runner/routing overlays differed. The before process was not retried or narrowed.
- The complete **before parallel block** finished: runner Duration **2,974.39 s**, 798 reported test files (160 failed, 633 passed, 5 skipped); 4,430 reported tests (396 failed, 3,959 passed, 75 skipped). This is a completed parallel-run reading, **not the alone-block criterion**.
- The **before alone block** began afterward, with 1,932 planned files. At interruption it had rows from **506 files**: 1,794 pass rows, 311 fail rows and 62 skipped rows. These are reporter rows, not a whole-suite pass count. It never emitted its final end record or Duration.
- The after lane never started. Therefore the required complete before/after alone-block pair is **INCONCLUSIVE**, not zero, a projected speedup or PASS.

## Demonstrated stall

The existing `tests/acceptance/1477/record.test.ts` runs real-window `lists_1477 measure` and `arm blank` commands. Its unchanged process limits are 1,800,000 ms for measure and 900,000 ms for one arm.

The first `measure --arms blank,list-10k` stayed blocked for its full 30 minutes. Process sampling showed the child inside GPUI/AppKit's event loop with nearly no CPU. When the test's own timeout killed the measure parent, its child was reparented to PID 1 and retained the captured output pipe. Only that previously observed, PID/start/command-verified owned orphan was terminated. The timeout failure remained; cleanup did not produce a pass.

The next direct blank arm exhausted its unchanged 15-minute timeout. The file then started another full measure, which again remained idle. The machine reported unlocked. CoreGraphics showed the expected owned 1,200 px-wide test window on-screen; ordinary activation of only the verified test process succeeded but did not restore progress. System Events accessibility inspection was denied; no security setting was changed. Both timeout failures are retained in `mac-run-progress.json` as observations from the real reporter.

## Ending the failed attempt

After roughly **6 h 55 min** of real full-run execution, the current block had already spent over an hour in this existing benchmark and its repeated timeout paths. The owned pair was stopped rather than holding the machine's exclusive timed grant indefinitely. Only PID/start/command-verified descendants of this session's measurement were signalled; survivors received SIGKILL only after identity recheck. Passive observer/finalizer processes owned by the session also ended. Other sessions and processes were untouched.

All test files, timeouts, assertions, lane selections and expected outcomes stayed unchanged. No skip, golden update, baseline waiver or rerun-until-green was used. The one accessibility-denied inspection and successful ordinary app activation are disclosed environment observations, not acceptance proof.

The owner approved proceeding, one PR and optional Spark. That approval does not change the still-written AC4 or establish a completed measurement. **#2321 remains the single PR; #1123 cannot claim its timing criterion from this partial run.** Repairing the baseline benchmark or explicitly approving a different measurement scope is required before another complete reading can be attempted. This report does not make that scope change itself.

## Evidence locations

- Durable redacted summary and the two exact reported timeout failures: `mac-run-progress.json`.
- Local full baseline log: `/tmp/deep-1123-mac-required/blocked-final/before.log`.
- Local captured serial output and report: `/tmp/deep-1123-mac-required/blocked-final/before-observed-block-1-{output,report}.txt`.
- Local process sample, observation and owned-cleanup record: `/tmp/deep-1123-mac-required/stall/` and `blocked-final/owned-processes.json`.

The local paths are session evidence, not portable proof. Their full bytes were retained; the repository summary has no personal host path or secret. No full after reading, no complete alone duration, and no passing whole-unit verdict is claimed.
