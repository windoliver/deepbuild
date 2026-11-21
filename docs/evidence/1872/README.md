# #1872 manual e2e

`run.sh` clones the PR branch fresh from GitHub, runs `npm ci`, and then `e2e.mjs`. It makes real commits in the clone
and judges each scene with the clone's own `node scripts/proof.mjs guard`.

| Scene | Commit | No tag | Signed tag naming it |
|---|---|---|---|
| a | the change's own failing test listed in `failures`, with an open issue and today's date | FAIL, naming the entry | PASS |
| b | `scripts/main-watch.mjs` loosened | FAIL, naming the file | PASS |
| c | `scripts/known-failures-check.mjs` loosened | FAIL, naming the file | PASS |

`e2e.log` holds the run, made on 2026-11-20 under load average 30–60.

Disclosures:

- The tags in the e2e are really signed, but by a throwaway security key from `tests/fixtures/approver.mjs`, not the owner's
  key. That key is added to `.deepbuild/approvers` at a local merge base that is never pushed.
- The clone was at branch head 7f781668a. Commits after that change only how merge commits are judged
  (`resolvedLooser`, the link check, `merge-base --all`). None of these scenes is a merge.
