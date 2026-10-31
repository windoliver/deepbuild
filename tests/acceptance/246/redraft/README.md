# Blind redraft: three #246 deps criteria in a world with #879's cards

Issue #879 adds a cards rule to the lint lane: every folder directly under `packages/` or `crates/` that holds a file git lists needs a `README.md` card with four level-2 headings (`## What it is for`, `## Where new code goes`, `## What it may import`, `## Deviations`), or the run prints `FAIL cards: …` and exits 1. Three tests in `../repo-rules.test.mjs` plant an uncarded package or crate and then require a pass, so under #879 they fail on the cards rule, not on the dependency rule they prove. Per AGENTS.md ("Proof"), that dispute goes to a blind redraft. This folder is that redraft. It edits no existing file.

Run it with:

```
node --test 'tests/acceptance/246/redraft/*.test.mjs'
```

It takes about 15 seconds; the Rust test runs `cargo metadata` six times.

## What this job read

- Issue #246's text, in full.
- `../README.md` (its readings, especially "The rules file", "Unshown wordings" item 5 and the deps rows), `../helpers.mjs`, `../lanes.test.mjs`, `../BASE-FAILURE.txt`, and the parts of `../repo-rules.test.mjs` outside the three disputed tests. The three disputed bodies were not read.
- `scripts/repo-rules.mjs` and `scripts/repo-rules.json`, AGENTS.md and the parts of `docs/technical-design.md` it points to.
- #879 only as the dispute states it: the card's four headings, `None.` under Deviations as a card with no deviations, and "which imports a package declares stays the dependency rule's (#246), never the card's".

The base is the checkout's HEAD, `f41a5b3e`. It differs from `69013e61` only by one line in `scripts/lanes.mjs` (a test folder added to a list); `scripts/repo-rules.mjs` is the same blob (`a5bad16`) in both.

## The only change from the first draft's world

Every folder the tests plant under `packages/` or `crates/` gets a minimal card: a `# <name>` title, the four headings with one line under each, and `None.` under `## Deviations`. The card says nothing about imports that the tests rely on. Everything else follows the first draft's readings: the rules-file layout from `../README.md` reading 1, `rulesFile`, `repo`, `rules`, `assertLine`, `assertNoState` and `FIX.deps` from `../helpers.mjs`, scratch repositories under the system temporary folder, nothing written into this checkout.

## How each criterion is read

"Passes" means what the other #246 tests mean by it: exit 0, no line from any check that starts with `FAIL`, `INVALID` or `BLOCKED`, and a `PASS deps: <n> package.json file(s) and <m> crate(s) match scripts/repo-rules.json` line. The counts prove the planted manifest was read; #246's first criterion shows that line's shape. Requiring no non-pass line from any check is what makes the card matter: an uncarded fixture would fail here under #879.

1. **"A new `packages/x/package.json` with a `dependencies` entry fails in the same way, and one with no dependencies passes."** The bullet list it closes starts "With `scripts/repo-rules.json` holding #12's three devDependencies", so the scratch repository's root `package.json` declares those three and the rules file lists them; that run passes first, with 1 package.json file. Then a new untracked `packages/x/package.json` with `"dependencies": { "left-pad": "1.3.0" }` and its card is added. "In the same way" is read as the wording of #246's `left-pad` line with the path and section changed: exit 1, exactly `FAIL deps: packages/x/package.json dependencies left-pad 1.3.0 is not in scripts/repo-rules.json` followed by the deps Fix line, and no `PASS deps`. Then the same file without a `dependencies` key passes, with 2 package.json files and 0 crates.
2. **"A fixture crate with `serde = "1"` under `[dependencies]` … under `[dev-dependencies]` or `[target.'cfg(unix)'.dependencies]` fails, naming that section. The same dependency listed with spec `^1` passes."** One fresh scratch repository per section, with the carded crate `crates/fx` (`Cargo.toml`, `src/lib.rs`). Each run exits 1 with exactly one `FAIL deps:` line, of the form `FAIL deps: crates/fx/Cargo.toml <section> serde ^1 is not in scripts/repo-rules.json`, followed by the deps Fix line, and no `PASS deps`. For `[dependencies]` the section word is exactly `dependencies`, which makes that line the issue's exact text. As in the first draft's reading 5, the other two need only name the section: the word holds `dev-dependencies`, or `cfg(unix)`. The dependency is then listed with spec `^1` under the section word its FAIL line printed (the first draft's reading 1), and the run passes with 1 package.json file and 1 crate.
3. **"A path dependency is listed relative to its manifest, and no absolute path appears in the output or in the list."** Two carded crates, `crates/fx` with `helper = { path = "../helper" }` under `[dependencies]`, and `crates/helper`. The run exits 1 with a `FAIL deps: crates/fx/Cargo.toml dependencies helper <spec> is not in scripts/repo-rules.json` line and the deps Fix line. As in the first draft's reading 5, the spec is whatever that line prints: it must hold `../helper` (relative to `crates/fx/Cargo.toml`, not to the repository root) and no absolute path (no `/` that isn't preceded by `.` or a word character). The output must not hold the scratch root or the temporary folder, realpathed or not. The spec is then listed back as printed; the rules file must hold no absolute path either, and the run passes with 1 package.json file and 2 crates, again with no absolute path in its output.

## Proof

`BASE-FAILURE.txt` records the run on HEAD and on six wrong programs, each built outside the repository from a copy of `scripts/repo-rules.mjs`. On HEAD all three pass: HEAD has the deps rule these tests prove and no cards rule, so a redraft is expected to pass there. Each criterion's test fails on the wrong program its criterion names, and a card-blind wrong program (HEAD plus a cards rule) still passes all three, while the first draft's three tests fail on it with `FAIL cards: …`.

## Not covered here

Whether #879's real cards rule accepts this minimal card can't be checked until #879 lands. The tests are not wired into any lane in `scripts/lanes.mjs`; that file isn't edited here.
