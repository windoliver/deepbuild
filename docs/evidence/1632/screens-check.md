# Independent check of the #1632 e2e screens and records

The screens of runs 4 and 5 ([e2e.md](e2e.md), "Model turns") were checked by separate validator agents on 2026-11-11.
Each was given only the files and their original sources (the saved ledgers, the throwaway home's transcripts and
`.claude.json`, git history), not the author's conclusions, and worked read-only. Each round was a fresh agent. Every
finding was fixed before the next round.

Screens checked: [screens/run5-turn-a.png](screens/run5-turn-a.png), [screens/run5-turn-b.png](screens/run5-turn-b.png),
their `.txt` captures, and [screens/run4-turn-b-before-fix.txt](screens/run4-turn-b-before-fix.txt).

| Round | Verdict | Found, then fixed |
|---|---|---|
| 1 | NEEDS FIXES | Claims with no screen or record behind them (run 4 turn A, the PreToolUse hooks, the mcp outliving `/clear`, "nothing goes to the old ID"); an abridged ledger excerpt; run 5's build not named; how the PNGs were made; the turn count. Fixed by adding the full ledgers, the run 5 `ps` and citations by log position. |
| 2 | NEEDS FIXES | 447d7035 → 84e67aa8 was a squash, not a rewrite; claims resting on scratch files (the pre-fix regression run, a saved copy); a cut `ps` line; the capture time; which home holds 2.1.317. Fixed by adding `records/regression-before-fix.txt` and the `mcpServers` entry, and dropping the unbacked byte-identity claim. |
| 3 | NEEDS FIXES | Five Haiku turns, not six (one probe was rate-limited before reaching the model, on 2026-11-08); the screen texts are trimmed captures; the e2e script and run 4's build were unbacked. Fixed by adding `records/run4-pane-full.txt` and `records/e2e.sh` and disclosing the trimming. |
| 4 | NEEDS FIXES | The condensed last line of the regression output; facts resting on a transcript outside the repo; which parts of `run5-procs.txt` were taken later. Disclosed. |
| 5 | NEEDS FIXES | The real home path in a records header (removed); run 5 turn A's trimming differs from the others (disclosed); a wrong reason given for the follow-up being a model turn (corrected). |
| 6 | VALID | Each PNG matches its text and is legible; every claim checked against the ledgers, transcripts and git; the records are byte-identical to fresh exports from the ledgers; no secrets or personal data under `docs/evidence/1632/`. |

What the screens show, as round 6 confirmed: after `/clear`, before the fix, B's `deep_ask`, `deep_claim` and
`deep_wait` were refused `unbound`. With the fix, B's calls were recorded under B (`ca074ffe…`), nothing after the clear
was filed under A (`a861b175…`), and B's `deep_wait` on A's ask was refused `not_found`.
