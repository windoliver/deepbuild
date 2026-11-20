# Dispute: #2204 AC3's first draft holds a newer entry to the rule #2219 retires

This redraft exists because of this dispute. The first draft is the second AC3 test of
`tests/acceptance/2204/rules-unreadable.test.ts` ("rules.json with the entry newer-than-this-hook (effect:not-a-class): a
PreToolUse for `pkill -f node` is denied, naming rules.json").

## What fails

#2204's AC3: "With the hub stopped, each of those two files denies the call, as today". The second file is the shipped
entries plus `newer-than-this-hook`, whose `match` is `effect:not-a-class`, in block mode and not fail_closed. #2204's
Scope left open what an older deep-hook should do with such an entry ("the whole file refused as today or the entries it
reads. That is a question for the owner"). #2219 answers it: deep-hook reads such an entry's mode and fail_closed, counts
it as matched on every PreToolUse, and with the hub away denies a call for it only when it is fail_closed.

On #2219's work the call is still denied, by no-kill-by-name, which is fail_closed. The newer entry isn't, so it no longer
denies, and the denial no longer names `rules.json`. The first draft reads "as today" as that wording, so it fails:

```
FAIL  rules-unreadable.test.ts > #2204.7c1b9c13 hub stopped, each of the two files denies the call, as today >
      #2204.7c1b9c13 rules.json with the entry newer-than-this-hook (effect:not-a-class): a PreToolUse for `pkill -f node`
      is denied, naming rules.json
AssertionError: the denial of `pkill -f node` must name rules.json: exit 2 after 31 ms, stdout "", stderr "DeepBuild
blocked this: Killing processes by name or port can stop another session's or worktree's processes, which run the same
scripts and ports. Kill by PID, only a process you started: kill <pid>. (guard no-kill-by-name, which holds while the hub
doesn't answer)\n": expected '\nDeepBuild blocked this: Killing pro…' to contain 'rules.json'
```

The first draft's other six tests pass on the work: AC1, AC2, AC3's cut file, AC4 (both) and AC5.

## How the redraft was made

AC3 went to a fresh run of a blind job with the same inputs: issue #2204, the design, and a base with #2204's work and
none of #2219's (`74e6e2634`). It never saw the first draft, #2219, its work, the diff or this dispute, and was told only
to write AC3's test. It reads "as today" as the call denied with the denial naming `rules.json` and why, and its newer
entry is a whole guard@1 entry in block mode and fail_closed. It passes on its base (`BASE-RUN.txt`), fails on both of
its wrong programs (`twins.json`), and passes on #2219's work (2 tests, one run, Nov 19, 2026):

```
✓ #2204.7c1b9c13 with the hub stopped, rules.json cut to its first 40 bytes denies a PreToolUse for `pkill -f node`,
  naming the file and that it isn't JSON, as today 32ms
✓ #2204.7c1b9c13 with the hub stopped, a readable rules.json that gains one entry whose match is effect:not-a-class
  denies a PreToolUse for `pkill -f node`, naming the file and the entry, as today 22ms
```

Its README's third open question names this case: if an older deep-hook reads the entries it knows, the first draft's
naming check would need a redraft, while the call is still denied by no-kill-by-name.

## What is decided, and what is yours

This is the one dispute that comes to you (design: Dogfooding).

- **Swap in the redraft** (recommended): it runs in the first draft's place. `scripts/lanes.mjs` keeps
  `tests/acceptance/2204/rules-unreadable.test.ts` by hand, since lanes set a file aside, not a test; its AC1, AC2, AC4
  and AC5 then run by hand with it, as #1493's did. Owed with it: the signed approval tag on that lanes commit.
- **Keep the first draft**: with the hub away, a block entry deep-hook can't read then denies the call naming the file
  whatever its fail_closed, which takes back #2219's Scope line "with the hub away it denies the call only when it is
  fail_closed" for block entries.

Nothing in either draft was edited.
