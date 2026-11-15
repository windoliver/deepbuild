# The dispute behind this redraft

`tests/acceptance/155/pack.test.ts`'s second test (AC9 `#155.eaff7d6a`, the planted preset) fails on the work before
it reaches a preset. It installs its planted pack and that pack's clean twin under the IDs `test/foley-planted` and
`test/foley-clean` while keeping the real manifest's `name: "foley"`, and the base's pack check (#306) refuses any pack
whose ID's name half isn't its `name`. So the clean twin, the pack's own `paper.tear@1` unchanged, is refused as well,
and no program can pass the test. The file's first test (the real pack, all 90 presets, installed and listed) passes.

The failing output, one run on the work:

```
AssertionError: an issue sits at presets/paper.tear@1, naming the preset; got [{"check":"document.validate",
"code":"out_of_range","severity":"error","ids":[],"path":"name","actual":{"id":"test/foley-planted","name":"foley",
"version":"1.0.0"},"what":"a pack names `owner/name`, with `name` its name half, and a whole `version`", …}]
```

and the clean twin's install, from the same run: `{"outcome": "refused", "pack": "test/foley-clean", "issues":
[{… "path": "name", "actual": {"id": "test/foley-clean", "name": "foley", …}}]}`.

This folder is a fresh run of the same blind job with the same inputs (the issue, the design and base `0e5572731`) and
the criterion, never the work, the diff or this dispute (design: Dogfooding). On the work it passes, 2 of 2, its planted
preset included; so the dispute goes to the owner once, with both drafts and this output. Until then the first draft's
`pack.test.ts` runs by hand (`scripts/lanes.mjs`), and this folder runs in the lanes.

## The owner's call

Nov 15, 2026, on PR #2613: "Yes, swap them". AC9 is proved by this redraft; the first draft's `pack.test.ts` stays by
hand.
