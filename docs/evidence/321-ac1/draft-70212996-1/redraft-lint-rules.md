# Repository lint rules a new blind suite must pass (from main, 2026-11-28)

## The wait ratchet (scripts/wait-ratchet.mjs), header verbatim
```
// The wait ratchet (#1604; technical design: Repo guards), run by the lint lane. A test waits for the event it needs,
// never for time to pass. It reads the test files (`testPaths` in scripts/lanes.mjs: JavaScript, TypeScript and Rust).
// A finding is a fixed wait: a `sleep(…)` call (`thread::sleep`,
// `sleep_ms` and `park_timeout` included), `Atomics.wait`, a `setTimeout` or `setInterval` timer, or a call through a
// name `setTimeout` is imported or promisified as; or a clock difference (`Date.now() - start`, `performance.now() -
// start`, `process.hrtime`, Rust's `.elapsed()`, `.duration_since(…)` or `Instant::now() - start`), or a name bound to
// one, inside an assertion's parentheses (`assert…(`, `expect(`, `ok(`). A timer or clock check that only bounds a wait,
// so all it can do is turn a hang into a failure, is allowed with its reason: a `// deadline: <why>` comment on its line
// or in the `//` lines just above, one marker for one finding. Strings and comments are not code.
// scripts/wait-ceilings.json lists today's files with their counts. A count may drop, and its ceiling drops with it in
// the same change; it never rises above its ceiling, a ceiling never rises above the merge base's with origin/main, and
// a file the merge base doesn't list starts at zero, so a suite drafted after this landed has none.
// A blind suite under tests/acceptance/ is never edited once it lands (AGENTS.md, Proof; #3139). So a planted twin, a
// file under a twins/ folder there, is out: it copies our own code at a base. A suite's own file is judged in the change
// that adds it, from zero; once the merge base holds it, a file with no ceiling is out.
// One `FAIL waits: …` line per finding, or one PASS line; exit 1 on a finding, 2 when git can't list the files.
```
Its patterns:
```
const SCRIPT = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const SLEEP = [/(?<!\bfn\s+|\bfunction\s+)\b(?:sleep|sleep_ms|park_timeout(?:_ms)?)\s*\(/g, 'sleep(…) is a fixed wait'];
const ATOMICS = [/\bAtomics\s*\.\s*wait(?:Async)?\s*\(/g, 'Atomics.wait is a fixed wait'];
const TIMER = [/\bset(?:Timeout|Interval)\s*\(/g, 'a timer is a fixed wait unless it only bounds one, marked // deadline: <why>'];
const CLOCK = /\b(?:Date|performance)\s*\.\s*now\s*\(\s*\)\s*-|\bprocess\s*\.\s*hrtime\b|\bInstant\s*::\s*now\s*\(\s*\)\s*-|\.\s*(?:elapsed|duration_since)\s*\(/g;
const CLOCKED = 'an assertion on a clock difference judges how busy the machine is, unless it only bounds a wait, marked // deadline: <why>';
const ASSERT = /(?<![\w$])(?:\w*assert\w*(?:\s*\.\s*\w+)?\s*!?|(?<!\.\s*)(?:expect|ok))\s*\(/g;
```
A new suite under tests/acceptance/ is judged from zero: it may hold no fixed wait. Every timer or clock check it keeps must only bound a wait (turn a hang into a failure) and carry `// deadline: <why>` on its line or in the `//` lines just above, one marker per finding.

## The comment ratchet (scripts/comment-ratchet.mjs)
A new file under tests/acceptance/ starts with a comment ceiling of 0: no comment lines at all in .ts/.mjs files, except marker lines such as `// deadline: <why>` in test files. Prose goes in README.md.

## Size
No source file over 1500 lines.
