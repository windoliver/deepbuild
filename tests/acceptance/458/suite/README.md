# Acceptance tests for #458 (suite group): twins, BLOCKED with a reason, an owner and an age, no retries, the release bar, nothing on push, the fixture scan and kit hygiene

Written first, blind, from issue #458 ("Parity suite: lanes, planted twins, no retries, the release bar and the
fixture scan": its Scope, its 19 acceptance criteria and its Proof line), its oracle page, the design sections it
links and those they lean on, and base commit `06e231702` ("Merge pull request #2735 …"), by a job that never saw an
implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding).

This folder holds the **suite group**: criteria 1, 2, 3, 4, 5, 6 and 8, numbered as the issue lists them. Criteria 7,
9 and 11 (`pairs`), 10, 12, 13 and 14 (`relations`) and 15 to 19 (`views`) are in sibling folders under
`tests/acceptance/458/`, written by other blind jobs whose files this job never saw.

What was read:

- The issue and its oracle page (`doneright/oracles/issues/458.md`): no upstream test checks any criterion; criteria
  1 to 5 and 8 are "our suite's own rules" and "verdicts against stub runners and stub suites", and criterion 6 is a
  check of our own repo. So every test here stands on its own stub fixtures and planted twins.
- `docs/technical-design.md`: How we know version 0 works (Conformance tests; Kit hygiene: "an expected failure in a
  kit whose case now passes ends itself, as a waiver does, and is reported. A GPU expected failure is a waiver keyed
  by backend, adapter and driver, with its reason … A case becomes must-pass only after clean runs on every backend it
  names"; Case lists, which #1789 owns and these tests leave out; Wrong programs; Criteria in a checked shape;
  Dogfooding; the parity-suite paragraphs: a planted-fault twin for every fixture, nothing skipped silently, the suite
  "runs in the local preflight, never on push or pull request", outside renderers as optional lanes that are BLOCKED
  without their tool and never must-pass, "Every comparison between two outputs has a planted-mismatch twin, and no
  fixture may be marked may-fail", and "Pixel numbers hold on one machine, so in the cross lane they're readings and
  the result is INCONCLUSIVE, except that a frame past the oracle's loose ceiling, or under a fixture's silhouette
  IoU floor, fails in any lane"); How runs become one of five verdicts (Known failures are waivers: "One whose check
  now passes ends itself, and its end is reported. The check keeps running and recording while it lasts"); Cutting a
  release (the release report's BLOCKED and INCONCLUSIVE lanes); Decided (The parity suite: "the quick lane during
  work and everything at release"; Outside renderers as local test oracles: "a config entry pointing to the local
  runner"; Oracle lanes).
- `docs/canvas-primitives.md`: Determinism, Golden, Determinism class.
- At the base: `AGENTS.md`, `CONTRIBUTING.md`; `scripts/lanes.mjs` (`checks`, `releaseLanes`, `writeRecord`: a lane's
  record names its lane, state, host and tree), `scripts/preflight.mjs`, `scripts/canvas-kit.mjs`, `scripts/parity.mjs`
  (a CLI version check, not this suite), `scripts/lane-x86.mjs`, `scripts/relay-kit.mjs` and `scripts/wasm32.mjs` (a
  lane script with `--planted <name>`), `scripts/repo-rules.mjs` (its secrets rule and its `API key` pattern),
  `scripts/public-text.mjs` and `scripts/studied-names.mjs` (a private list kept as salted hashes); the suites
  `tests/acceptance/138/` (the kit's `manifest`, sidecars with `twin`, `golden` reading BLOCKED `no_golden`, `decide`
  with `waive`), `1897/`, `140/` (one issue over three blind groups), `1830/` (a script run on scratch trees), `112/`
  and `12/` (no workflow on push).

What the base has and these tests don't credit: the kit's `manifest` lists 149 fixtures, 8 of them with a `twin` in
their sidecar; the kit runs a comparison's twin and reads the case INVALID when it passes; `golden` reads BLOCKED,
`no_golden`; `decide`'s `waive` records a reason on a fixture; `scripts/repo-rules.mjs` fails any file under
`.github/workflows/` and API-key and home-path shapes in tracked files. It has no lane runner over the fixtures, no
release report, no bar, no fixture scan, no list of character and film names, no expected failures, no must-pass
promotion and no waiver that ends itself.

## Run them

```sh
export PATH=/opt/homebrew/opt/rustup/bin:$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH
npx vitest run --root tests/acceptance/458/suite --testTimeout=600000
npx tsc -p tests/acceptance/458/suite/tsconfig.json
```

Node built-ins and vitest only: no cargo build, no GPU, no outside tool and no network. Every test writes into its own
temporary folder and deletes it. Each run of a script is one `node` process, so under load a file takes a minute or
two. `BASE-FAILURE.txt` is the run at the base: all 12 tests fail on an assertion, 11 because
`scripts/parity-suite.mjs` or `scripts/fixture-scan.mjs` is missing and one because no lane runs the suite.

`scripts/lanes.mjs`: this folder needs no list entry as written. One test, `twins.test.ts`'s "every fixture the
shipped suite lists", runs `parity-suite.mjs list`; if the implementer's `list` builds `deep-show` to read the kit's
manifest, `tests/acceptance/458/suite/twins.test.ts` belongs in `alone`, and the implementer makes that edit.

## The surface under test

The issue names lanes, twins, a release report with a bar, a fixture scan, waivers, expected failures and must-pass,
but no command, file or field. The base runs its lanes as scripts under `scripts/` that the preflight starts
(`canvas-kit.mjs`, `gpu-validation.mjs`, `lane-x86.mjs`), plants wrong lanes with `--planted <name>`, and the design
gives an outside lane "a config entry pointing to the local runner". So these tests name two scripts.
**Every name below that the issue or the design doesn't give is this job's choice; the implementer builds exactly
these, or a dispute goes to a blind redraft.** Verdict words are PASS, FAIL, BLOCKED, INVALID and INCONCLUSIVE. Times
are RFC 3339 in UTC. Existing surfaces stay as they are.

### `node scripts/parity-suite.mjs`

```
node scripts/parity-suite.mjs run <lane>        [--suite <file>] [--store <dir>] [--commit <id>] [--now <time>] [--planted <name>]
node scripts/parity-suite.mjs report            [--suite <file>] [--store <dir>] [--commit <id>] [--now <time>] [--planted <name>]
node scripts/parity-suite.mjs promote <fixture> [--suite <file>] [--store <dir>] [--commit <id>] [--now <time>] [--planted <name>]
node scripts/parity-suite.mjs list
```

- `<lane>` is `quick`, `full`, `cross` or `oracle`, the issue's four.
- `--suite <file>`: the suite file (below). Without it the suite is the shipped one: the fixtures the kit's
  `manifest` lists, with the implementer's own lanes, waivers and expected failures. The tests always give one,
  except for `list`.
- `--store <dir>`: where the suite keeps what it must remember between runs: each lane's rows by commit, each
  fixture's results by commit and machine, when each block began, which waivers and expected failures ended, each
  fixture's clean runs by backend, and the must-pass set. Its layout is the implementer's; the tests read none of it.
  The default is the implementer's choice.
- `--commit <id>`: the commit this run is of, or the report judges (default: the checkout's HEAD), as #138's
  scenario field `commit`.
- `--now <time>`: the time the run reads as now (default: the clock), from which ages are counted.
- `--planted <name>`: one of the three wrong suites below; any other name is a usage error, exit 2.
- Each subcommand prints one JSON object as the **last line** of stdout; lines for a person may come before it.
  `report` exits 0 only when the bar holds. The tests read no other exit status.

#### The suite file

```json
{"lanes": {"quick" | "full" | "cross" | "oracle": {"runner": [command, argument, …]}},
 "fixtures": [{"name": "parity/<category>/<name>.<profile>",
               "lanes": [lane],                    // the lanes that run it
               "backends": [backend],              // the backends it names
               "owner"?: string,                   // who a block on it goes to
               "twins": [{"name": string, "comparison"?: string}],
               "pixels"?: {"loose_ceiling": number, "iou_floor": number}}],
 "waivers": [{"fixture": name, "reason": string}],
 "expected_failures": [{"fixture": name, "backend": string, "adapter": string, "driver": string, "reason": string}]}
```

- A fixture's name follows the kit's scheme (#138); its category is the name's second part.
- `twins` are its planted-fault twins. A twin with `comparison` is that comparison's planted-mismatch twin. What
  else a twin entry holds (#138's `path` and `value`, say) is the implementer's and goes to the runner as it is.
- `pixels` belongs to a fixture whose comparison is of pixels: the loose ceiling its FLIP may not pass and the
  floor its silhouette IoU may not go under.
- An expected failure's `adapter` is the adapter's name and `driver` its driver, as the device reports them.
- `list` prints the shipped suite in this shape (`lanes` may be left out of it).

#### A lane's runner

`run <lane>` starts the lane's `runner` command **once**, writes one request per line to its stdin and closes it, and
reads one reply per line from its stdout, in the order asked. It asks for each fixture that lists the lane, in the
suite file's order: first the fixture itself, then each of its twins in order.

```json
request: {"lane": lane, "fixture": name, "twin": null | <the twin's entry>}
reply:   {"verdict": "PASS" | "FAIL" | "BLOCKED" | "INCONCLUSIVE", "reason"?: string, "digest"?: string,
          "backend"?: string, "adapter"?: {"name": string, "driver": string, "type": string},
          "comparisons"?: [{"name": string, "verdict": "PASS" | "FAIL"}],
          "pixels"?: {"flip": number, "iou": number}}
```

- `verdict` and `reason` are the runner's own reading of that one run, as the kit's `golden` call gives them
  (`BLOCKED` with `no_golden`; `BLOCKED` with why it can't run here). `digest` names what the run drew.
- `backend` and `adapter` say what the run drew on, read from the device; the `adapter` fields are the `adapter`
  call's (#140).
- `comparisons` lists each comparison of two outputs the run made. A twin's reply lists them too, as that twin
  left them.
- `pixels` are a pixel comparison's numbers.
- Nothing is retried: one request for a fixture's own run in one run of a lane, whatever it answers.
- A runner that can't be started (its command isn't there) answers nothing: every fixture of the lane then reads
  BLOCKED, `no_runner`.

The tests' runner is `fixtures/stub-runner.mjs`, laid in a temporary folder as an executable and given a plan file;
"removing the lane's tool" removes that executable.

#### A lane's record: what `run <lane>` prints

```json
{"lane": lane, "commit": id,
 "rows": [{"fixture": name, "verdict": V, "reason": string | null, "owner": string | null,
           "since": time | null, "age_days": whole number | null,
           "twins": [{"name": string, "verdict": V}],
           "comparisons": [{"name": string, "verdict": V, "reason": string | null,
                            "twin": {"name": string, "verdict": V} | null}],
           "results": [{"verdict": "PASS" | "FAIL", "digest": string}],
           "reading": bool}],
 "ended": [{"kind": "waiver" | "expected_failure", "fixture": name}]}
```

One row per fixture that lists the lane. More fields are the implementer's. The rules, in the criteria's words:

| Rule | Row |
|---|---|
| The fixture's run passed and each twin failed (criterion 1) | `PASS`; `twins` lists each twin with its verdict |
| A twin's run passed (1) | `INVALID`, `reason: "twin_passed"`; `twins` shows which |
| It has no twin (1) | `INVALID`, `reason: "no_twin"` |
| Its own run failed (1) | `FAIL` |
| A comparison's mismatch twin failed that comparison (5) | the comparison keeps its own verdict, `reason: null`, `twin: {name, verdict: "FAIL"}` |
| A comparison's mismatch twin left it passing (5) | the comparison is `INVALID`, `reason: "twin_passed"`, `twin: {name, verdict: "PASS"}`; the row is `INVALID` |
| No twin names the comparison (5) | the comparison is `INVALID`, `reason: "no_twin"`, `twin: null`; the row is `INVALID` |
| The runner says it can't run, or that the golden is missing (2) | `BLOCKED`, `reason` the runner's (`no_gpu`, `no_golden`) |
| The lane's runner can't be started (2, 3) | `BLOCKED`, `reason: "no_runner"` |
| A waiver names the fixture and it fails (2, 8) | `BLOCKED`, `reason` the waiver's reason |
| An expected failure names the fixture and the run's `backend`, `adapter.name` and `adapter.driver`, and it fails (8) | `BLOCKED`, `reason` the entry's reason |
| A waiver's or a matching expected failure's fixture passes (8) | `PASS`; the entry ends itself: `ended` names it and its fixture in that run, and later runs judge the fixture as usual |
| Two different results for one fixture, lane and commit on this machine (2) | `INCONCLUSIVE`, `reason: "two_results"`, `results` holding both, the earlier first |
| A pixel comparison past its `loose_ceiling` or under its `iou_floor`, in any lane (3) | `FAIL`, `reason: "past_loose_ceiling"` or `"under_iou_floor"` |
| A pixel comparison within both, in the cross lane (3) | `INCONCLUSIVE`, `reading: true` |

- Every `BLOCKED` row carries `owner` (the fixture's, or null), `since` (the `--now` of the run where this
  fixture began reading BLOCKED in this lane, kept while it stays BLOCKED, across commits) and `age_days` (whole
  days from `since` to this run's `--now`). Other rows have `since: null`.
- `results` holds every PASS or FAIL the fixture's own run gave for this lane and commit on this machine, each
  once, oldest first. A BLOCKED run adds none.
- A FAIL a lane recorded for a commit stays that commit's result when a later run of the lane there can't run.

#### The release report: what `report` prints

```json
{"commit": id, "bar": "PASS" | "FAIL",
 "fixtures": [{"fixture": name, "category": string, "must_pass": bool, "verdict": V,
               "reason": string | null, "owner": string | null}],
 "failures": [{"fixture": name, "verdict": V}],
 "readings": [{"fixture": name, "lane": "cross"}]}
```

- It reads the store's rows for `--commit` only. A fixture with a lane that has no row for that commit doesn't
  read PASS.
- `fixtures` lists every fixture of the suite. Its `verdict` is PASS when every lane it lists has a PASS row for
  the commit; with one lane failing, blocked, invalid or inconclusive, it is that lane's verdict, with its
  reason. Readings are left out of it, and a fixture with nothing but readings doesn't read PASS.
- The bar, applied per fixture: a must-pass fixture must be PASS; any other must be PASS, or BLOCKED with an
  owner and a reason; FAIL, INVALID and INCONCLUSIVE fail it. `failures` lists each fixture that fails the bar,
  once; `bar` is PASS only when it is empty, and then the script exits 0.
- `readings` lists the cross lane's rows with `reading: true`. They are in no failure and count as no pass.

#### Promotion to must-pass: what `promote <fixture>` prints

```json
{"outcome": "promoted", "fixture": name}
{"outcome": "refused", "code": "clean_runs_missing", "fixture": name, "missing": [backend]}
```

A fixture is must-pass only once promoted. `promote` is refused while the store holds no clean run (a PASS row,
whose reply named the backend) on some backend the fixture names; `missing` lists those backends, in the fixture's
order. The tests make the clean runs on the commit the promotion names.

### `node scripts/fixture-scan.mjs [<path> …]`

The fixture scan. Given paths, it scans every file under each (a folder is walked); with none, every canvas
fixture and its evidence, which is the implementer's list. It looks for secret patterns (at least the repo's own
`API key` shape, `scripts/repo-rules.mjs`), the local paths `/Users/`, `/private/tmp/` and `/Volumes/`, and the names
on the scan's list of character and film names from other works. It prints one line per finding,

```
FAIL fixture scan: <file>:<line>: <what>
```

where `<file>` ends with the file's path under the folder given and `<line>` counts from 1, and exits non-zero; with
no finding it prints no line starting with `FAIL` and exits 0. A path that isn't there doesn't pass: non-zero.

**The scan's list** is private, as `scripts/studied-names.json` is, so a blind test can't know a name on it. The
implementer adds one made-up character name to it for this test: the two made-up words `Vexlorn` and `Dramble`,
in that order, joined by one space. `scan.test.ts` puts it together at run time, as it does the key and the paths,
so no committed file holds a planted value whole.

### `scripts/lanes.mjs`

- A lane in `checks` has a command whose arguments hold `scripts/parity-suite.mjs`, `run` and `quick`.
- A lane in `releaseLanes` has a command holding `scripts/parity-suite.mjs`, `run` and `full`, and one holding
  `scripts/parity-suite.mjs` and `report`.
- No lane in `checks` runs `run full` or `report`.

## The planted programs

`--planted <name>` on `parity-suite.mjs`, each the suite with one rule wrong, reachable only through that argument:

| Name | What it does wrong, in its criterion's words | Criterion |
|---|---|---|
| `expected_failure_kept` | an expected failure is kept after its fixture passes: it isn't ended, so a later failure still reads BLOCKED | 8 |
| `expected_failure_by_backend` | an expected failure is keyed by backend alone, so it hides a failure on a second driver | 8 |
| `promoted_on_one_backend` | a fixture is promoted after clean runs on one of its two backends | 8 |

Each of criterion 8's three checks runs twice: on the suite as it is, where it must find nothing, and on its
planted suite, where it must fail with a line naming the fixture.

Criterion 6's plants are planted values, not programs: the key, the three paths and the name, each in a
temporary fixture tree, beside a clean tree that differs only in those values.

Criteria 1, 2, 3, 4 and 5 name no planted program. Their wrong programs are the base and the mutants each file's
header lists; each test holds cases a suite that does nothing, or passes whatever ran, gets wrong.

## Criteria to tests

IDs are `#458.<h8>`: the first eight hex digits of the SHA-256 of each criterion's text, trimmed and with white
space collapsed (`scripts/proof-change.mjs`). Every test's name starts with `AC<n> #458.<h8>`.

| AC | ID | File | Tests |
|---|---|---|---|
| 1 | `#458.ad2c506c` | `twins.test.ts` | Five stub fixtures in the quick lane: twins fail → PASS, with the twin asked for after the fixture; one of two twins passes → INVALID `twin_passed`, naming it; the only twin passes → INVALID; no twin → INVALID `no_twin`; own run fails → FAIL. And `list`: every shipped fixture, the kit's named ones among them, has at least one twin |
| 2 | `#458.fa585b23` | `blocked.test.ts` | One test, three rounds: a fixture its runner can't run (`no_gpu`), one whose lane's tool is missing (`no_runner`), one with no golden (`no_golden`) and a waived one that fails each read BLOCKED with that reason, their owner, `since` the first run and `age_days` 0; the same an hour later; `age_days` 3 three days later on the next commit. Each fixture's own run is asked for once a run. A FAIL then a PASS of one commit read INCONCLUSIVE `two_results` with both results and digests; the same result twice stays PASS |
| 3 | `#458.d1e38bf0` | `bar.test.ts` | Four stub lanes and a promoted must-pass fixture. (a) The bar holds, exit 0, with the must-pass fixture PASS, a GPU fixture BLOCKED with owner and reason, an oracle fixture PASS and a cross-lane reading; it fails, naming exactly the fixture, on a commit no lane ran, a must-pass fixture BLOCKED, a BLOCKED fixture with no owner, a FAIL, an INVALID and an INCONCLUSIVE. (b) A cross-lane pixel comparison at FLIP 0.12 and IoU 0.97 against a ceiling of 0.3 and a floor of 0.9 is a reading, in `readings` and in no failure; 0.31 or 0.89 is a FAIL; an INCONCLUSIVE with no pixel numbers fails the bar. (c) The oracle lane fails on the release commit; its tool is removed and the lane run there again; the report still reads the fixture FAIL and the bar FAIL. On the next commit it is BLOCKED `no_runner` with its owner and the bar holds |
| 4 | `#458.d13e155c` | `preflight.test.ts` | `checks` runs `run quick`; `releaseLanes` runs `run full` and `report`; `checks` runs neither of those two; no workflow, tracked, new or on disk, that starts on a push or a pull request names the suite's scripts or the preflight |
| 5 | `#458.ae77277a` | `twins.test.ts` | Three same-result-two-ways fixtures in the quick lane and two oracle-lane fixtures with two comparisons each: a mismatch twin that fails its comparison → the comparison PASS with its twin named; one that leaves it passing → the comparison and the fixture INVALID `twin_passed`; no twin naming the comparison → INVALID `no_twin`, though the fixture has a planted-fault twin that fails; in the oracle lane, only the comparison whose twin passed is INVALID |
| 6 | `#458.78a02001` | `scan.test.ts` | A planted key, `/Users/` path and name, and a `/private/tmp/` and a `/Volumes/` path, in a fixture, its sidecar and its evidence: five findings, each naming its file and line, and no other; the clean tree passes; an absent folder doesn't |
| 8 | `#458.33b0fb5c` | `hygiene.test.ts` | Three tests, each on the suite and on its plant. A waiver and an expected failure read BLOCKED with their reasons while failing, end and are reported with their fixtures when passing, and a later failure is FAIL. An expected failure for driver 1.0 leaves the same fixture failing on driver 2.0 a FAIL. A fixture naming `vello_cpu` and `gpu` is refused must-pass after a clean run on `vello_cpu`, `missing: ["gpu"]`, and promoted after both, and the report's `must_pass` follows |

## Readings where the issue and design leave a choice

1. **A script, not a call of a proof binary.** The suite is verdict logic over runners, and the oracle page calls
   these "verdicts against stub runners and stub suites". A script takes a stub runner as a command, needs no cargo
   build, and is what the preflight's lanes are at the base.
2. **The suite file stands in for the manifest.** The kit's `manifest` lists fixtures a build registers, so a stub
   fixture there would need a test build per case. The suite file gives the same facts (name, twins, backends) and
   the ones the issue adds (lanes, owner, waivers, expected failures). #138's sidecar keys stay as they are; how the
   shipped suite's twins, owners and lanes are kept is the implementer's, and `list` shows the result.
3. **A fixture with no twin is INVALID**, as a check that can't fail is (design: Wrong programs), and so is a
   comparison with no planted-mismatch twin. Criterion 1's first half is also held on the shipped suite through
   `list`; at the base 141 of the manifest's 149 fixtures have no `twin`.
4. **A comparison's mismatch twin is the twin that names it.** A planted-fault twin of the fixture that happens to
   fail doesn't stand in for it. The twin passes when the comparison it names still passes in the twin's run.
5. **"A fixture that can't run"** is read two ways, both tested: its runner says so, and its lane's runner isn't
   there. **"A missing golden"** is the runner's `BLOCKED`, `no_golden`, which the kit's `golden` call already
   answers; the suite carries it and adds the owner and the age.
6. **The owner** is the fixture's `owner`. The design's file mapping paths to people isn't in the base, so the
   suite file carries the name. A BLOCKED fixture with no owner fails the bar.
7. **The age** is counted from the run where the fixture began reading BLOCKED in that lane, in whole days, and
   runs on across commits. The design asks for "a cause, an owner and an age" and gives no unit.
8. **A waiver's reason** is the BLOCKED row's reason. A waived fixture and one with an expected failure keep
   running (design: "The check keeps running and recording while it lasts").
9. **"Nothing is retried"** is read as one request for a fixture's own run in one run of a lane, and as no later
   run of the same commit on the same machine replacing an earlier one: a FAIL and then a PASS are two different
   results, INCONCLUSIVE with both attached. A new commit starts again. "Different" is tested on results that
   differ in verdict and digest.
10. **A BLOCKED run is no result.** It adds nothing to `results`, and it doesn't replace a FAIL the lane recorded
    for the commit (criterion 3's last clause). On the next commit the same missing tool reads BLOCKED, which the
    bar accepts with an owner and a reason, since an oracle lane's fixtures are never must-pass.
11. **"Applies the bar to the release commit"**: only rows recorded for `--commit` count. A commit no lane ran on
    fails the bar through its must-pass fixture; what the unrun lanes' other fixtures read there isn't asserted.
12. **Readings** are the cross lane's pixel comparisons whose numbers the suite itself holds against the
    fixture's `loose_ceiling` and `iou_floor`; a cross-lane INCONCLUSIVE with no numbers is an ordinary
    INCONCLUSIVE. The tests stay off the boundaries (0.12 and 0.31 against 0.3; 0.97 and 0.89 against 0.9).
    The measure's field is `flip`, the design's name for it.
13. **Promotion is an act**, `promote`, refused until the clean runs exist. One clean run on each backend is
    enough here; the criterion says "clean runs" and gives no count. Who may promote is not this criterion's
    subject.
14. **An ended entry stays in the suite file**; the store remembers that it ended. A committed list the script
    rewrites would serve too, but the tests' suite file is their input.
15. **Criterion 4's "runs in the local preflight"** is read on `scripts/lanes.mjs`, which the preflight runs:
    the quick lane in `checks`, the full lane and the report in `releaseLanes` (Decided: "the quick lane during
    work and everything at release"). The cross and oracle lanes aren't required there: cross is "from R3" and
    the oracle lanes are optional.
16. **The scan's paths.** The Scope lists three local paths and the criterion plants one; all three are planted.
    The scan is given the tree to read, since which files are "every canvas fixture and its evidence" in the
    checkout is the implementer's list.
17. **One runner process per lane run**, JSON lines in and out, as the proof binaries speak. A lane that draws a
    fixture on more than one backend isn't modelled: each stub lane reports one backend.

## Not covered, and why

- **The real lanes**: that `run quick` over the shipped suite passes, that `full` holds the GPU lease on the
  reference Mac, that `cross` goes through the hosts block (#1942) and that an oracle lane drives an outside
  renderer. These need builds, a GPU, a second machine or a private runner; the release run is their proof (the
  issue's Proof line). The other three groups own what the full lane draws.
- **The default scan** over the checkout's own fixtures and evidence, and that the preflight runs the scan
  "before commit": the file list is the implementer's, and the criterion plants values rather than naming a lane.
- **"No fixture may be marked may-fail"** as a refusal of such a mark: #138's manifest test holds it for
  sidecars, and here nothing can mark one, since a nondeterministic result is INCONCLUSIVE and a skip BLOCKED.
- **Case lists** (`lane.cases@1`, the seven counts): #1789.
- **Who may waive, bless or promote**: #138's `decide` holds decisions to you; these tests give the suite its
  waivers and expected failures as data.
- **A twin that can't run**, a runner that dies mid-lane, and results from two machines: no criterion here names
  them.

## Checked against a sample implementation

In a scratch folder outside the checkout, never committed, this job wrote a sample `parity-suite.mjs` and
`fixture-scan.mjs` to this README and ran the suite against them: see the report this job delivered for what
passed and which mutants each test failed.
