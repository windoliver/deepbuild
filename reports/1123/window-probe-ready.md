# Native visibility probe: built, observation still BLOCKED

The old external `kCGWindowIsOnscreen` observation means ordered on screen, not AppKit's occlusion-visible state. Source review found no missing-notify justification: `request_animation_frame` already queues notification. This is a diagnostic question, not permission to rewrite the renderer or lower the 480-frame requirement.

A scratch-only probe now records native `WindowVisibility` / `deep_app::shown::seen` transitions and reads the existing foreground journal's callback, draw, submission and skip events. It requests no extra frame, refresh or input and does not change sample counters. Instrumented timings are **not acceptance or budget evidence**. Production and acceptance files in the PR contain none of this instrumentation.

- Initial build admission expired after 20 minutes; no compile ran.
- After the prior build holder ended, the second admission request succeeded. The first actual compilation completed successfully in **31.77 s**, using the original release `lists_1477` target and fixed workspace cache.
- Captured executable SHA-256: `1c1a686bba4929a6194ac099ba63dc4231ba630f65956bed1bbda9c0dfa73a21`.
- Instrumented source SHA-256: `6d7fbebb6715895e24c145e3eb5a4ee36fddfd35ce674902411550de3299b5ba`.
- A one-shot prerequisite waiter then checked the logged-in desktop for 20 minutes. It ended with exit 3: **`BLOCKED: desktop stayed locked for 20 minutes; no observation or test started`**. The instrumented executable has not been run. No security setting was changed, and no attempt was counted as PASS.
- The earlier debugger alternatives produced no usable visibility evidence; their failures remain local. The orphaned owned debugger after a process-scan timeout was PID/start/command-verified and stopped. All owned diagnostic, build, waiter and affected processes from this continuation have ended; there is no background measurement to poll.

Local ready artifacts under `/tmp/deep-1123-resume/`: `probe-lists-1477`, `lists-observation-probe.rs`, `probe-artifact.json`, `window-probe-provenance.json`, `probe-build-admission2.{jsonl,log,exit}`, and `observe-probe.py`. With the desktop actually unlocked, that observer performs one bounded diagnostic through the normal test throttle; it rechecks the desktop before launching. No result exists yet. The old `full-pair/before` workspace has been instrumented and **must not be resumed as unchanged same-workload timing input**.

This advances diagnosis preparation, not #1123.273f1f14. A complete uninstrumented Mac before/after unit reading remains absent. The original uncommitted watchdog candidate still has no unchanged passing GUI regression. The separate trace review also identified the capped runner/long-observation evidence-contract gap; no policy, acceptance criterion, signature or guard was changed to erase it.
