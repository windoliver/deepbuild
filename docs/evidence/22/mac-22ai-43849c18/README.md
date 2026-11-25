# Mac round 22ai at 43849c18b (2026-11-20)

Short round on the MacBook Pro, Mac18,1 (Apple M6, 32 GiB, a #319 reference Mac at this head), on AC power. The run used a fresh GitHub clone at #2097's head 43849c18b (merge base main 7ba31d777), removed afterwards. Nothing waited for load (40 to 200). The scan finds 0 login-name hits and 0 email hits; its 5 secret-pattern hits are the usual `#an-ask-and-…` URL anchor.

| Step | Result |
| --- | --- |
| deep-app | `--lib` **132/132**. The whole crate exits 101 on the **same 7 failures as 22ah** (diff empty) |
| Setup | exit 0 |
| 319 budgets | **2/2 PASS**. Create p50 2.07–2.49 ms against 5. Answer p50 4.54–4.90 ms against 5 (margin 8%). Inbox with 10,000 asks 1.0–1.5 ms against 100 |
| Judge | **exit 0, 1451 s, PASS**: #22.48b6696b, #22.1f14a778, #22.f57a814c and #22.3d85284a all PASS. Free disk was 15 GB after the budgets. The disk guard waited until 48 GB was free (23:18 to 23:20) before running the judge. The gh probe matched before and after |
| e2e-app, kept frontmost | **`e2e-front2/`**: exit 0. deep-app was frontmost in 54 of 63 samples, the display was held awake by caffeinate, and the owner was away; nothing was typed. **All three screenshots match `deep inbox`**: before the batch "Nothing needs you", after it 8 asks (A1, B1, D1–D5, "This session keeps asking"), after "together" 2 (A1, B1). The task box is empty |

`e2e-front/` is the first attempt. It also exited 0 with the CLI right (8, then 2), but the Mac locked at 23:27:49, 20 s before shots 1 and 2. The lock screen covered the window and froze those shots (identical pixels, "Nothing needs you"). It's kept as a record and is superseded by `e2e-front2/`.
