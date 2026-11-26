# Dispute: #1828 AC3's first draft can't set up on main since #2062

This file is the work's, not the blind job's. The job wrote the other files of this folder from issue #1828,
`docs/technical-design.md` and base `914bd5f29`, for the criterion `#1828.44a54c78` alone, and never saw the work,
the first draft, this note or the reason a redraft was asked for.

## What fails

`../update.test.ts` installs acme/feed 1.0.0, which provides `ext.feed.level@1` with no kept digest, and acme/board,
whose use of it states a digest (`helpers.ts`, `feedPackage` and `boardPackage`). Since 3af2909f2 (#2062, "a stated
digest needs a kept one"), a provider's row that keeps no digest serves only a use that states none
(`packages/extension-host/src/compose.ts`, `mismatch`). So acme/board refuses to install before the update the
criterion is about:

```
Error: the edge acme/board uses ext.feed.level@1 doesn't match acme/feed's ext.feed.level@1 at minor 0: they first differ at /, so acme/board isn't installed
 ❯ Host.wireCheck packages/extension-host/src/host.ts:652:22
 ❯ Host.install packages/extension-host/src/host.ts:541:10
 ❯ installAll tests/acceptance/1828/helpers.ts:172:25
 ❯ tests/acceptance/1828/update.test.ts:27:3
```

It fails the same way at the PR's head bacc84809 (main 914bd5f29 merged) and with `packages/hub/src/core.ts` and
`plant.ts` reverted to main's, so no hub program passes it. At its own base, 2eaaeb0e6, before #2062, it set up and
passed on the work (4/4 at c5ebda2fa). #2062 is intended, so main has nothing to fix; the test can't be edited
(AGENTS.md, Proof).

## The redraft

| Program | Result |
|---|---|
| base 914bd5f29 (main, no fix) | FAIL: "REFUSED: acme/acme@2.0.0 no longer provides what installed pieces use (acme/stocks uses ext.acme.prices@1), and this host has no asks core to ask you; nothing was installed" (`BASE-FAILURE.txt`) |
| the work, be4cc06a5 | PASS, 1/1; tsc 0 |

## How the job was briefed

The brief named the issue, the design sections, the base and the criterion's text. One line went beyond that: it told
the job that every package it sets up must install on the base as the host requires today, and to read the host's
install, wire and compose code, "including digests", so its fixture is valid. That points at the cause without naming
it.

## What runs where

`../update.test.ts` is kept as written and runs by hand only; this folder runs in its place
(`scripts/lanes-lists.mjs`), pending the owner's ruling on this dispute.
