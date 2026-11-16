# Signed approvals the #2331 stack is owed

`node scripts/proof.mjs guard`, run on this branch as stacked (`b1efbb3c9`, 2026-11-16), refuses the edits in
[guard-stacked.txt](guard-stacked.txt). Four commits need an annotated tag under `deep/approved/`, signed by a key
on `.deepbuild/approvers` with its touch. An agent can't make one, and none was made. No approval tag for any of them
exists locally or on origin.

| PR | Commit | What the guard refuses |
|---|---|---|
| #2643 | `188fd91cdafb` | `tests/acceptance/1463/helpers.ts`: 2 lines changed |
| #2712 | `b1ba07ee96ca` | `tests/acceptance/1463/list.test.ts` (4 tests) and `tests/acceptance/992/agree.test.ts` (1 test) changed |
| #2712 | `7e738af1b6a6` | the two `.proposed` copies, deleted after the swap |
| #2689 | `40cf1d64579b` | `scripts/lanes.mjs`: the proof lanes' own code |

Each commit touches only the files its tag names.

```sh
git tag -s deep/approved/188fd91cdafb-sk 188fd91cdafb1b7d7aee3a3a9bef71c7dfb00d12 -m "Approve 188fd91cdafb for #2333" -m "Approves: tests/acceptance/1463/helpers.ts"
git tag -s deep/approved/b1ba07ee96ca-sk b1ba07ee96ca2f46cf082f0dc24d4f16878dce1c -m "Approve b1ba07ee96ca for #2668" -m "Approves: tests/acceptance/1463/list.test.ts" -m "Approves: tests/acceptance/992/agree.test.ts"
git tag -s deep/approved/7e738af1b6a6-sk 7e738af1b6a6f52f1b05a665b911001e40ef8329 -m "Approve 7e738af1b6a6 for #2668" -m "Approves: tests/acceptance/2668/proposed/tests/acceptance/1463/list.test.ts.proposed" -m "Approves: tests/acceptance/2668/proposed/tests/acceptance/992/agree.test.ts.proposed"
git tag -s deep/approved/40cf1d64579b-sk 40cf1d64579b0e09d9df98a6e3833beb7d37ccd5 -m "Approve 40cf1d64579b for #2331" -m "Approves: scripts/lanes.mjs"
git push origin deep/approved/188fd91cdafb-sk deep/approved/b1ba07ee96ca-sk deep/approved/7e738af1b6a6-sk deep/approved/40cf1d64579b-sk
```

Two commits an earlier version of this page listed need none in this landing order:

- `a67f7dbaa46a` (`tests/acceptance/2331/kit.ts`, 1 line added) is refused only while the stack is judged as one
  change, where the guard keeps every tag. Once #2643 and #2712 are on main, #2331 is the one issue the change names,
  and no test tagged `#2331.` read `kit.ts` before that commit. This is read from `scripts/proof-guard.mjs`, not from
  a guard run in that state.
- `0fdd1716e97c` (the regression twin and its `tsconfig.json`) is not refused at all.

A signature approves an edit. It makes no unrun or inconclusive check pass.
