# #1820 export acceptance disposition

## Owner authorization

After both drafts and their differing results were disclosed in PR #2192 and its handoff, the owner directed: **“close the gaps that the pr close the issue”** (this coding session). This disposes the already-redrafted export criterion in favor of its independent blind redraft. No new redraft was commissioned, no assertion was rewritten, and no product behavior was changed to satisfy the defective draft.

## Adopted check

`tests/acceptance/1820/export-redraft/` is adopted **unchanged**. It has four checks on the real `deep export` CLI:

- Two versions of one pack produce red and blue PNGs respectively.
- After upstream changes and the network closes, the old version re-exports byte-identically twice with no request or ask.
- A missing version produces no PNG and names the pack.
- Two exports using an unfetched offline asset are BLOCKED, produce no PNG, and raise exactly one unblock ask and no authority ask.

It was drafted by a fresh job from only the issue, design and base `903a1c070`, without the implementation, original export draft or dispute. Its four checks passed at the previous PR head; the closure run rechecks it with the other issue criteria. `pr-export-redraft-check.log` and `pr-final-affected.log` in the local proof directory retain those results.

## Superseded draft, retained byte-for-byte

`superseded-export.test.ts.fixture` is the exact former `tests/acceptance/1820/export/reexport.test.ts`, retained as audit data rather than a second active definition of this criterion. Its original committed form remains at commit `024578c4d`; its SHA-256 is `04568cf7a02b783abbb510cc26c0762e14a4e995f00cf55cc2c2c8d809e42b30`. The adopted redraft's `export.test.ts` SHA-256 is `97549bcc4f136a16627eafbfbce54ed0285b49bb3c8c83c2ebce7d4b1a15cbe1`.

The draft's offline test raises an unblock ask. Its later `fetchOnce` counts **all** asks, then its helper filters to **authority** asks before slicing by that count. One old unblock plus one new authority therefore yields `[authority].slice(1) = []`, not the one ask the program actually raised. That assertion fails, never sends the yes, and consequently leaves the dependent export held. The unchanged blind redraft proves the intended behavior without this bookkeeping error.

The move is this approved acceptance replacement, not an ignored failure, a weakened assertion, or a blanket permission to change checks. The original non-export acceptance tests and all redraft files remain unchanged.
