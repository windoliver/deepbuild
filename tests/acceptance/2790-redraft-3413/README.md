# Blind redraft of #2790's purpose test under #3413

Written blind at base commit `9539bc612` (`origin/main`, the merge base), from issues #3413 and #2790, `GLOSSARY.md`, the design and that base. The drafting job saw no work that implements #3413: no other branch, pull request, diff or session's files. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft by this job.

## Why a redraft

#3413 settles, by `GLOSSARY.md`'s entry **Extension** (_Avoid_: plug-in), that the two design docs and the extension guide say "extension" wherever they say "plug-in", and that the guide's sentences, which come from `scripts/guide.mjs`, say it too. `tests/acceptance/2790/purpose.test.ts`'s first test, `#2790.56435eb8 it is a plug-in's side of a piece's port`, requires the guide's `deep.registerPort` entry to match `/plug-in's side of (?:a|the) piece's port/i`. Once #3413 lands, no guide that follows the glossary passes it, though the entry still says what the method is for. No program passes it without undoing #3413's settled word, so the file is redrafted, not edited. `BASE-RUN.txt` ends with the original failing on such a guide.

The original is not edited or deleted; it runs by hand once the swap is approved, and this folder runs in its place.

## What was read

- AGENTS.md; issue #3413 and issue #2790 (their bodies); `GLOSSARY.md`, entry **Extension**.
- `tests/acceptance/2790/` whole: README, helpers.ts, purpose.test.ts, tsconfig.json, twins.json, twins/.
- `scripts/lanes-lists.mjs` (`redrafted`, `byHand`) and `scripts/lanes.mjs` (`testGlobs`, which `vitest.config.ts` includes, so a `.test.ts` here runs in the unit lane as the original does).
- The redraft folders `1113-redraft-3549/` (REDRAFT.md), `1113/DISPUTE-3549.md` and `1352-redraft-3402/` (README), for the house form.
- `scripts/guide.mjs` at the base, line 61: the `deep.registerPort` description.

All files were read as they are at `9539bc612`.

## The one change

`purpose.test.ts` here is `tests/acceptance/2790/purpose.test.ts` with every test carried, because the lanes swap whole files: the same `describe`, the same eight test names and IDs (`#2790.56435eb8`), the same order, timeouts and assertions. It imports `../2790/helpers.ts` unchanged (`portFields`, `purpose`, `writtenPortEntry`) and copies no helper. Its three comment lines are dropped, since a new file's comment ceiling is 0.

The first test's second assertion is the only change:

| | Original | Redraft |
|---|---|---|
| pattern | `/plug-in's side of (?:a\|the) piece's port/i` | `/(?:extension\|plug-in)'s side of (?:a\|the) piece's port/i` |
| message | the entry says deep.registerPort is a plug-in's side of a piece's port | the entry says deep.registerPort is an extension's or a plug-in's side of a piece's port |

The call: the redraft takes either word, not "extension" alone. With either, the test passes on the base (which says plug-in) and on the guide #3413 asks for (which says extension), so it holds before and after #3413 lands and the swap can come first. What the criterion asks, that the entry names the method as the extender's side of a piece's port, is still required word for word; only the name for the extender is widened to the two the glossary maps to one idea. Taking "extension" alone would fail on the base, so the swap would wait on #3413. Whether the guide still says plug-in anywhere is #3413's own check, not this test's.

The test's name keeps "plug-in's", because lanes and twins read tests by name and ID and the file swap must carry the names unchanged. Test 5's name ("makes the plug-in a device gate owner") is unchanged as well; its assertions never named the word.

## Twins

None here. `tests/acceptance/2790/twins.json` maps `#2790.56435eb8` to `port-undescribed` and `port-opens-on-register`, both whole-file `scripts/guide.mjs` twins, and this file keeps that ID. Under `port-undescribed` all eight tests still fail at the exit status; under `port-opens-on-register` tests 6 to 8 still fail and test 1 passes, since that twin says "plug-in's side". Neither twin was run by this job.

## Runs

`BASE-RUN.txt` (local paths redacted):

1. Base `9539bc612`'s `scripts/guide.mjs`: 8 of 8 pass.
2. A copy whose `deep.registerPort` entry says "An extension's side of a piece's port" instead of "A plug-in's side": 8 of 8 pass. The original file fails its first test on this copy.
3. A copy with the phrase removed ("For a piece's port: ..."): the first test fails at the pattern; the other seven pass.

Each copy differs from the base in that one line. `tsc --noEmit -p tests/acceptance/2790-redraft-3413/tsconfig.json` exits 0 at the base. Run with:

```
npm run build --workspaces
node node_modules/vitest/vitest.mjs run tests/acceptance/2790-redraft-3413
```
