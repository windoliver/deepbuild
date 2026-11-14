# The dispute behind this redraft

The first draft's text-under-4.5:1 pair (`tests/acceptance/1938/faults.test.ts`, criterion `#1938.f19b61dd`, and its
Oracle lane `tests/acceptance/1938-oracle/contrast.test.ts`) fails on the work at its clean twin, before contrast
decides anything. Its caption reads "Seventy percent", a number, and the document's own validation raises
`number_unsourced` (honest numbers: a number shown with no source); a requirement's row counts every issue of the
revision, so the twin's row is FAIL whatever render.contrast measures. render.contrast itself reads the planted caption
at 3.2439:1 (the formula's 3.2439) and the twin at 16.8614:1, as the Oracle lane's port wants.

The failing output, one run on the work:

```
AssertionError: render.contrast's clean twin of text under 4.5:1 passes:
  render.contrast on the clean twin of text under 4.5:1 is FAIL, not PASS: {"id":"req:01JB1938Q00000000000000002",
  "kind":"render.contrast","issues":[{"check":"document.validate","code":"number_unsourced","severity":"error",
  "ids":["caption"],"path":"items/caption/params/text","actual":"Seventy percent","what":"shows a number with no
  source or as-of time; bind it to a reading, or compute it in the document", …}],"machines":"same",
  "determinism":"same_machine","results":[{"t":0,"item":"caption","ratio":16.861417418983887,"ground":1,"min":4.5,
  "pass":true, …}],"fingerprint":"vello_cpu/vello_cpu 0.3/macos/cpu","result":"FAIL"}
```

The Oracle lane fails the same way (`the caption over 4.5:1 passes: … raises number_unsourced by document.validate
[caption]`). The first draft's other eight pairs and its criterion 2 file pass on the work.

This folder is a fresh run of the same blind job with the same inputs (the issue, the design and base `23baa43b4`) and
the criterion, never the work, the diff or this dispute (design: Dogfooding). On the work it passes, 2 of 2, its plant
`contrast_min_3` included; so the dispute goes to the owner once, with both drafts and this output. Until then the first
draft's faults file and its Oracle lane run by hand (`scripts/lanes.mjs`), and this folder runs in the lanes.
