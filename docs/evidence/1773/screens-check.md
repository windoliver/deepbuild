# Independent check of the #1773 e2e screens and records

The screens and records of [e2e.md](e2e.md) were checked by separate validator agents on 2026-11-13. Each was given
only the files and their sources: the runs' hub ledgers, setup and hub logs, Claude Code transcripts, the throwaway
homes' configs, the systemd journal, and the two trees' git history and builds. None was given the author's
conclusions, and each worked read-only. Each round was a fresh agent, and every finding was fixed before the next round.

| Round | Verdict | Found, then fixed |
|---|---|---|
| 1 | NEEDS FIXES | The fix's "nothing listed" had no positive control, and its SessionStart didn't sync, so listing might not have run. The refusal's real cause (an old deep-hook against a newer `rules.json`) was left out. `deep_wait`, not `deep_claim`, was called. The systemd links were described as dangling. Fixed by adding listing runs with a third-party `forge` server and a synced start on both sides, and by rewriting those parts. |
| 2 | NEEDS FIXES | The commits on the branch were miscounted. Not every later setup exited 3. The setups differed between sides, undisclosed. The fix's no-overrun margin wasn't stated. The listing panes weren't kept. The script stops a hub found by name. All disclosed or fixed. |
| 3 | NEEDS FIXES | #2092's head had moved on since the runs. The main-unbound run's build and renamed folder weren't stated. Three more systemd-started hubs went unnamed. A second glyph also drew as a box. A paraphrase was quoted as the hub's words. Fixed. |
| 4 | NEEDS FIXES | A quote marked "in full" was cut short. The dump query wasn't recorded. An unsent draft showed on one screen. One hub's stop wasn't backed. Fixed. |
| 5 | VALID | Each PNG matches its text and is legible. Every claim was checked against the ledgers, logs, transcripts, journal and git. The four event records match fresh dumps exactly. No secrets or personal data are under `docs/evidence/1773/`. Three wording notes were applied after. |

Round 5 also raised the same point as the code review: on a hub restart, `core.ts`'s `waitsState` rebuilds open calls
and history from the record for every tool, our own included. The e2e never restarted the hub mid-turn. It is a
follow-up, not part of this evidence.
