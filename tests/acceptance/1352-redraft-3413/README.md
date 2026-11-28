# Acceptance tests for #1352, blind redraft for #3413: the browser decision's word

Written blind at base commit `c13122f6a` (main, with nothing that implements #3413), from issues #3413, #1352 and
#3402, the design, `GLOSSARY.md` and that base. The drafting job saw no work that implements #3413: no other commit,
branch, worktree or pull request, and no untracked suite in the checkout was read. The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft by this job (design: Dogfooding). Nothing here edits
`tests/acceptance/1352-redraft-3402/` or `tests/acceptance/1352/`; both stay as they are.

## Why a redraft

`GLOSSARY.md` settles one word for what you add: **Extension**, "_Avoid_: plug-in". #3413 moves the design docs to it:
"Each plug-in in the prose of the two design docs says extension", and the lint lane's text check "also fails plug-in in
the docs' prose". `tests/acceptance/1352-redraft-3402/ac1-section.test.mjs`, the active test for #1352's criterion 1,
judges the browser decision by six words, one of them `/\bplug-ins?\b/i`, from #1352's Scope ("An agent, a page or a
plug-in still can't answer an ask"). The base section says it once: "An agent, a page or a plug-in holds no passkey, so
none of them can answer an ask." Once #3413 lands, that sentence says extension, and the lint check fails any design
that keeps plug-in. So no design that follows the glossary can pass the 3402 test, though the section still answers
the decision (BASE-RUN.txt, run 5: the 3402 file fails on such a design at `/\bplug-ins?\b/i` alone). The test is
redrafted, not edited, as #3402 redrafted the first draft and #3549 redrafted #1113's and others' files.

## What was read

- **The issues**: #3413 (Scope, criteria, the glossary entry it cites), #1352 (Scope's eight decisions, criterion 1),
  #3402 (why the 3402 folder exists). **AGENTS.md.** **`GLOSSARY.md`**, entry **Extension**.
- **The design**, `docs/technical-design.md` at the base: A hub of your own in the cloud (`#cloud-hub`), its browser
  bullet in full, and Dogfooding.
- **The suites**: `tests/acceptance/1352-redraft-3402/` whole (README, helpers, the three test files);
  `tests/acceptance/1352/README.md`, What "answers" a decision means.
- **House shape and lanes**: `tests/acceptance/1113-redraft-3549/REDRAFT.md`, `scripts/lanes-lists.mjs` (`redrafted`,
  `byHand`, the #3402 and #3549 entries), `scripts/loads-lint.mjs` (how `redrafted` is read).

## Run

```sh
node --test tests/acceptance/1352-redraft-3413/ac1-section.test.mjs
```

Node 24 and the checkout, Node built-ins only: no `npm ci`, no build, no network, no git. Two tests, under a second.
Nothing is written anywhere.

## The one change

The browser decision's fifth word, `/\bplug-ins?\b/i`, becomes `/\bextensions?\b|\bplug-ins?\b/i`: the section holds
`extension` (the glossary's word) or `plug-in` (the word the base, and #1352's own Scope, use). The decision's label in
the failure message says "extension (plug-in)" to match. Nothing else changes: the other five browser words, the other
seven decisions and their words, the eight `Not taken`, the finder, the section's extent, the test's name and its
assertions are the 3402 redraft's, character for character (the diff of `DECISIONS` against the 3402 helpers is that one
line; `sectionCheck` is copied unchanged).

Why both words, not `extension` alone: the base section says plug-in, and the redraft has to pass the design as main
holds it until #3413 lands, then pass it after; requiring `extension` alone would fail every design before #3413's
docs change, a right one included. Keeping plug-in acceptable doesn't let a stale design through #3413: its own lint
check fails plug-in in the docs' prose, and that is #3413's to prove, not #1352's. Neither word appears anywhere else in
the base section, so accepting either doesn't let some other sentence stand in for this decision.

## Files

- `ac1-section.test.mjs`: the two tests of the 3402 file, same names (so lanes read the same criterion ID,
  `#1352.4c4e63a7`), same assertions, without its comments.
- `helpers.mjs`: `DECISIONS` (with the one change) and `sectionCheck`, copied from the 3402 helpers. `findSection`,
  `readDesign`, `decidedCheck` and `ADDED_QUESTIONS` are imported from `../1352-redraft-3402/helpers.mjs` and not
  copied: the finder and the Decided reading are then the 3402 ones by construction, and no duplicate is made. The
  3402 helpers' `CHECKOUT` is relative to their own file, so both folders read the same checkout.
- `BASE-RUN.txt`: the runs below, as printed.

## The Decided rows test: carried, not redrafted

The 3402 file's second test, the seven rows #1352 added in the Decided tables, doesn't read the section's words, so it
needs no change, and it isn't redrafted: it is carried here as it stands, name and assertions unchanged, calling the
3402 helpers' `decidedCheck` itself. It is here because the lanes swap by file: once a redraft is named in `redrafted`,
its original file runs by hand only (`byHand`), so a test left only in the 3402 file would drop out of the lanes. This
is the same reason `1113-redraft-3549/cli.test.mjs` carries #1113.060e7bae unchanged.

The 3402 folder's other files, `ac3-agent-routes.test.mjs` and `ac5-taste-call.test.mjs`, read neither word and stay in
the lanes as they are. #3413 does change criterion 5's input, though: the taste call's record binds the section's
SHA-256, and replacing the section's one plug-in changes that hash, so `ac5-taste-call.test.mjs` will fail until a
person makes the taste call again on the new text. That is the test doing its job (the call was made on other text),
not a fault of the test, and this job doesn't redraft it. Checked once by hand, not recorded in BASE-RUN.txt: on copy 2
with `docs/evidence/1352/taste-call.json` copied in as the base holds it, the 3402 `ac5-taste-call.test.mjs` fails with
`text.sha256 "7f96048a…" isn't the section's text as it is now (0c6c8986…): the call was made on other text`.

## Runs

All in BASE-RUN.txt, on macOS, node v24.22.0, at `c13122f6a`. Each copy is a temp folder holding the design as described
and the two redraft folders copied unchanged; the checkout was never written.

| Run | Design | Expected | Result |
|---|---|---|---|
| 1 | the base, as the checkout holds it (says plug-in) | both tests pass | PASS, 2 of 2 |
| 2 | a copy, the section's one "plug-in" replaced by "extension" | both tests pass | PASS, 2 of 2 |
| 3 | a copy, the section's whole browser bullet deleted | section test fails naming the browser decision | FAIL, naming it (missing `web client`, `own hub`, the extension word) and "Not taken" 7 times; Decided test passes |
| 4 | a copy, only "or a plug-in" removed from the browser bullet | section test fails naming the extension word alone | FAIL, missing `/\bextensions?\b\|\bplug-ins?\b/i` alone |
| 5 | the 3402 file on copy 2 | its section test fails, the dispute | FAIL, missing `/\bplug-ins?\b/i` alone |

So on this base the redraft PASSES, as it should: the base section says plug-in, and plug-in is still accepted.

## Not tested

- Copy 2 replaces the word literally, giving "a extension"; the test reads words, not grammar, and how the sentence
  reads is criterion 5's taste call.
- Whether #3413's actual change keeps the browser sentence at all, or rewords it past `extension`: no implementation was
  seen. A reworded sentence that drops the word fails this test as it would have failed the 3402 one.
