# #22's app screenshots at fdd40361, checked by a separate agent

The Mac15,12 ran `docs/evidence/22/e2e-app.test.ts` at fdd40361 (vitest 1 of 1, 87 s; on battery at load 6–7, which matters only because nothing here is timed). An independent agent, given the screenshots, `app-run.txt`, the script and the design but not my reading, checked each one.

| Screenshot | Verdict | Why |
|---|---|---|
| `0-before-batch.png` | **PROBLEM** | All 9 asks show in Needs you ("9 asks need you"), but `deep inbox` lists them `queued` before the 14:14:00Z batch. The design says "Asks come in batches", and the script expects Needs you to be empty here. |
| `1-needs-you.png` | **PROBLEM** | Byte-identical to shot 0 (sha256 3ecf5b7c…). The batch changed nothing in the window. It counts 9 where `deep inbox` has 8 shown, because the folded ask (screen 6) is drawn and counted as its own row. |
| `2-after-bulk-answer.png` | OK | After `deep inbox answer <exception> together`, only A and B show, "2 asks need you", and D's session has left "needs you". This matches `deep inbox`. |

All three are real captures of the deep-app window alone, with nothing personal in them.

**Cause, in the code.**
- `crates/deep-app/src/record.rs` marks each `ask.created` row `shown` at once and never reads `ask.batched`.
- `crates/deep-app/src/views.rs` draws and counts every row that isn't closed, `queued` and `folded` ones included.
- `crates/deep-app/src/notify.rs` notifies on `ask.created`.

So the app doesn't follow the batches that the hub's inbox projection, the one "the CLI and the app read" (#319), keeps.

**Not fixed here yet.** The fix is in the app. It also changes what about 35 Mac-only app acceptance suites see: they run setup, which drafts 8-hour batches, then expect a new ask in Needs you or a notification within seconds. See the PR for the open decision.
