# 0005: The gate's floor, a claim's verdict record, price and size

Status: accepted. Moved from comments in `packages/gate` by #3454's first pass ([0001](0001-code-carries-no-comments.md)). The design states the rules these serve under An agent says it's done, Whose checks count, One budget and Size and scope; the decisions below are the ones written nowhere else.

## The floor's cites

- **A claim's cites are the backticked spans of its final message.** `packages/gate/src/floor.ts`, `citesOf`. Words outside them decide nothing.
- **A cite resolves first to the run typed as the cite.** `packages/gate/src/floor.ts`, `validityGate`. Only when none was typed so does it take the first run the cite extends with its arguments (#1860).
- **The cite's own text masks too.** `packages/gate/src/floor.ts`, `validityGate`. Whichever run it matched, `pnpm test || true` proves nothing beside `pnpm test`.
- **Anything else in backticks that reads as a shell command is a run never made.** `packages/gate/src/floor.ts`, `validityGate`. A cite with white space that starts with a program-like word and resolves to nothing is sent back as a run the session never made.
- **A package script that isn't a string runs nothing the floor can read.** `packages/gate/src/floor.ts`, `scriptOf`.

## A claim's verdict record

- **A check can't fail by either mask.** `packages/gate/src/claim.ts`, `claimVerdict`. The locked command's own mask counts, and so does one the kind found by the same rule in what the command runs (a script or a package.json script, named `<mask> in <file>`). The kind's other uncounted causes, an untraced program or altered evidence, name no mask the rule reads.
- **A run whose report can't record a failure makes its check one that can't fail.** `packages/gate/src/claim.ts`, `claimVerdict`. A report that showed a control passing, or no control at all, proves nothing (#1099).
- **A check proves by a static check only when no test tool counted its runs.** `packages/gate/src/claim.ts`, `claimVerdict`. A check with a run a test tool's report counted, or of a kind that doesn't say, proves by a test run, so a lower proof is never shown as a higher one (#1861).
- **A run that never started is the machine's, so yours to provide.** `packages/gate/src/claim.ts`, `recordOf`. Its record names why, such as a program the run's PATH lacks or a checkout gone, with you as its owner.

## Whose checks count

- **The root package.json counts only for its scripts.** `packages/gate/src/own.ts`, `ownChanges`. When its scripts changed and the run read it, the script target the check runs is the check's own. A package.json under one of the check's own folders counts like any file there.
- **The files a test tool loads by its own rules are the check's own, wherever they lie.** `packages/gate/src/own.ts`, `ownChanges`. Beside the files a run read under the repo's test, fixture and script folders, a claim's changed files that are a runner's config, pytest's `conftest.py`, or a file a runner config names, such as a setup file, count as the check's own (#33).

## What a claim leaves open

- **A final message is read in a fixed order, and no sentence twice.** `packages/gate/src/open.ts`, `leftOpen`. Its open sections' items come first, then each sentence that says it found a bug and left it, or filed one as an issue instead of fixing it. A sentence the sections already hold isn't read again.
- **A message that says nothing is empty, only marks, or an agent's no-content placeholder.** `packages/gate/src/open.ts`, `endsEmpty`. A stop that did work and ends on one gets a completion prompt (#82).
- **The solve line names the first thing that keeps a definition from being solved, in one order.** `packages/gate/src/open.ts`, `solveLine`. A requirement with no check comes first. Then the checks are read pair by pair in their listed order, and the first pair that covers the same thing (the same bytes, or the same words) or can't both pass (one subject bounded both ways with no value between) is named. A threshold with no unit comes last.

## Admission, price and size

- **A check kind with no budget never runs.** `packages/gate/src/kinds.ts`, `admitKind`. Every kind declares what one run may take in time and cost, so a claim's runs can be planned and billed before they start (#68).
- **Prices are summed in micro-dollars.** `packages/gate/src/price.ts`, `priceDefinition`. Cents then add up exactly. A price nobody knows leaves the total unknown, never free.
- **A duplicated block is read from files as the change leaves them.** `packages/gate/src/size.ts`, `duplicatedLines`. In the work tree only a regular file within `READ_MAX` is read, never a link followed; at a named head the file is read whole from git. A binary is never compared. The runs compared are each hunk's added lines, and an untracked file whole.
