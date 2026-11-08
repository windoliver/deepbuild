# Manual e2e for #1633

Run at 7d0a0078 (the fix merged with origin/main d4ed7be7), Node 24.22.0, Linux arm64, 2026-11-08.
The real hub as a process, the real deep-hook for every Claude Code hook, and the real `deep` CLI (`deep inbox`,
`deep inbox answer`), in a temp world with HOME set to it (#322's world, reused). GitHub's answers are recorded
(DEEP_HUB_TEST_GITHUB, #323's `prAnswers`): PR 21 with one review thread T by maya, its answers changed between stops.
The driver is `e2e.test.ts.txt` beside this file (saved as text so no suite picks it up), run as `e2e.test.ts` with vitest from a scratch folder:

    E2E_OUT=transcript.txt vitest run --root <scratch> e2e.test.ts --testTimeout=900000

What it shows, in order: claim 1 opens T's item (v2) and raises its accept ask, and `gh pr edit 21 --body "Closes #7"`
is refused naming T; claim 2 (maya resolved T) closes the item; claim 3 (T unresolved again) opens it again under the
same item ID as `open_item.opened@4` with `replaces` naming the closing, Closes is refused naming T, and the inbox
still holds the one accept ask from claim 1, no second; `deep inbox answer … accept` closes it ("your answer:
accepted") and Closes is allowed; claim 4 (T still unresolved) leaves it closed, and the inbox has no open asks.

Seen in passing, outside #1633: between claims 2 and 3 the accept ask stays in your inbox while T's item is closed by
maya's resolution (as on main), which is also what lets claim 3's reopened note reach you without a second ask.

## Transcript

```
hub pid 1853529; task task:item7; definition locked
gh pr create: allowed

== Claim 1: GitHub says T is unresolved
stop reply: https://github.com/acme/shop/pull/21 · Part of · BLOCKED 1/1 · 2 tests · next: you · receipt
DeepBuild: https://github.com/acme/shop/pull/21 is open as Part of its issue, with review still unmet. Keep working on it in the same pull request: push to its branch, open no new one.
https://github.com/acm
T's open-item events so far:
  log_pos 22 open_item.opened@2 {"item":"6972db9d33fa","from":"review_thread"}

$ deep inbox   # after claim 1
ask:01M6YMXDNV4KB0XBA6ZH3Q6VYV  exception    5s  shown  Accept this review note on the PR of task:item7 without a fix, so the PR may say Closes? Review thread PRRT_kwDOAcmeE2E01 on https://github.com/acme/shop/pull/21 (src/auth.js:3), https://github.com/acme/shop/pull/21#discussion_r77001, first comment by maya: “Name the reason a token was rejected in the 401 body.”  [accept | keep]

$ gh pr edit 21 --body "Closes #7"   # T open
  REFUSED: DeepBuild blocked this: the pull request can't say Closes #7 while a review note on it is neither fixed nor accepted. Fix each, or have it accepted through its ask, and say Part of #7 until then: Review thread PRRT_kwDOAcmeE2E01 on https://github.com/acme/shop/pull/21 (src/auth.js:3), https://github.com/acme/shop/pull/21#discussion_r77001, first comment by maya: “Name the reason a token was rejected in the 401 body.”.

== Claim 2: GitHub says T is resolved by maya
stop reply: https://github.com/acme/shop/pull/21 · Part of · BLOCKED 1/1 · 2 tests · next: you · receipt
DeepBuild: https://github.com/acme/shop/pull/21 is open as Part of its issue, with review still unmet. Keep working on it in the same pull request: push to its branch, open no new one.
https://github.com/acm
T's open-item events so far:
  log_pos 22 open_item.opened@2 {"item":"6972db9d33fa","from":"review_thread"}
  log_pos 98 open_item.closed@2 {"item":"6972db9d33fa","by":"review thread PRRT_kwDOAcmeE2E01 resolved by maya"}

$ deep inbox   # after claim 2
ask:01M6YMXDNV4KB0XBA6ZH3Q6VYV  exception    11s  shown  Accept this review note on the PR of task:item7 without a fix, so the PR may say Closes? Review thread PRRT_kwDOAcmeE2E01 on https://github.com/acme/shop/pull/21 (src/auth.js:3), https://github.com/acme/shop/pull/21#discussion_r77001, first comment by maya: “Name the reason a token was rejected in the 401 body.”  [accept | keep]

== Claim 3: GitHub says T is unresolved
stop reply: https://github.com/acme/shop/pull/21 · Part of · BLOCKED 1/1 · 2 tests · next: you · receipt
DeepBuild: https://github.com/acme/shop/pull/21 is open as Part of its issue, with review still unmet. Keep working on it in the same pull request: push to its branch, open no new one.
https://github.com/acm
T's open-item events so far:
  log_pos 22 open_item.opened@2 {"item":"6972db9d33fa","from":"review_thread"}
  log_pos 98 open_item.closed@2 {"item":"6972db9d33fa","by":"review thread PRRT_kwDOAcmeE2E01 resolved by maya"}
  log_pos 165 open_item.opened@4 {"item":"6972db9d33fa","from":"review_thread","replaces":"01M6YMXK2EWDFWKPZ3EBZYGNXE"}

$ deep inbox   # after claim 3
ask:01M6YMXDNV4KB0XBA6ZH3Q6VYV  exception    17s  shown  Accept this review note on the PR of task:item7 without a fix, so the PR may say Closes? Review thread PRRT_kwDOAcmeE2E01 on https://github.com/acme/shop/pull/21 (src/auth.js:3), https://github.com/acme/shop/pull/21#discussion_r77001, first comment by maya: “Name the reason a token was rejected in the 401 body.”  [accept | keep]

$ gh pr edit 21 --body "Closes #7"   # T reopened
  REFUSED: DeepBuild blocked this: the pull request can't say Closes #7 while a review note on it is neither fixed nor accepted. Fix each, or have it accepted through its ask, and say Part of #7 until then: Review thread PRRT_kwDOAcmeE2E01 on https://github.com/acme/shop/pull/21 (src/auth.js:3), https://github.com/acme/shop/pull/21#discussion_r77001, first comment by maya: “Name the reason a token was rejected in the 401 body.”.

$ deep inbox answer ask:01M6YMXDNV4KB0XBA6ZH3Q6VYV accept
  exit 0 ask:01M6YMXDNV4KB0XBA6ZH3Q6VYV answered accept; no decision saved
T's open-item events:
  log_pos 22 open_item.opened@2 {"item":"6972db9d33fa","from":"review_thread"}
  log_pos 98 open_item.closed@2 {"item":"6972db9d33fa","by":"review thread PRRT_kwDOAcmeE2E01 resolved by maya"}
  log_pos 165 open_item.opened@4 {"item":"6972db9d33fa","from":"review_thread","replaces":"01M6YMXK2EWDFWKPZ3EBZYGNXE"}
  log_pos 237 open_item.closed@2 {"item":"6972db9d33fa","by":"your answer: accepted, closed without a fix"}

$ gh pr edit 21 --body "Closes #7"   # T accepted
  ALLOWED

== Claim 4: GitHub says T is unresolved
stop reply: https://github.com/acme/shop/pull/21 · Part of · BLOCKED 1/1 · 2 tests · next: you · receipt
DeepBuild: https://github.com/acme/shop/pull/21 is open as Part of its issue, with review still unmet. Keep working on it in the same pull request: push to its branch, open no new one.
https://github.com/acm
T's open-item events so far:
  log_pos 22 open_item.opened@2 {"item":"6972db9d33fa","from":"review_thread"}
  log_pos 98 open_item.closed@2 {"item":"6972db9d33fa","by":"review thread PRRT_kwDOAcmeE2E01 resolved by maya"}
  log_pos 165 open_item.opened@4 {"item":"6972db9d33fa","from":"review_thread","replaces":"01M6YMXK2EWDFWKPZ3EBZYGNXE"}
  log_pos 237 open_item.closed@2 {"item":"6972db9d33fa","by":"your answer: accepted, closed without a fix"}

$ deep inbox   # after claim 4: T still unresolved, accepted
No open asks.
```
