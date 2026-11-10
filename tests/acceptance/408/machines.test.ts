// #408.5416e245: "film.layout's results are equal on macOS and Linux, and 60 cue ends × 40 texts × 200 strokes of 64
// segments check in under 50 ms on the reference Mac"
//
// Fixtures (helpers.ts): five films judged together: criterion 1's axis line through the label, criterion 2's formulas
// sharing 6% and its rect drawn over a text, criterion 3's title past both edges, and `bigFilm`: 40 text@1 labels on an
// 8 × 5 grid, 200 open path@1 waves of 64 segments each in a group a linear channel moves 180 u down over 6 s (so no two
// cue ends are equal by evaluated data), and 60 cues of 0.1 s, so cue ends every 0.1 s from 0.1 to 6.0 s.
//
// Equal on macOS and Linux: one `deep-show run` of the five films' verdicts on this Mac (`full`, debug) and the same
// scenario in a linux/amd64 container (`full` built there from this checkout, as #238's and #532's suites build
// theirs). Each film's film.layout row must be decided here (PASS or FAIL, the crossing and the big film FAIL), and
// its result, `blocked` and issues (each issue whole, compared as sorted canonical JSON) must be the same on Linux.
// Without Docker or its linux/amd64 rust image, or off macOS, that half is INCONCLUSIVE, never a pass.
//
// Under 50 ms on the reference Mac: the perf lane's own judgeLimit (scripts/benchmark.mjs) first says whether this
// machine can judge a timing now (a reference Mac on mains power, Low Power Mode off, thermal state nominal, the load
// under the core count); if not, INCONCLUSIVE before anything is built. If so, `full` is built in release, and the
// big film is judged in one warm-up process and then five more, each a fresh process so no cache carries over. In
// each, the row must FAIL with issues whose `ts` list all 60 cue ends (film.layout checked every one), and its
// `timing.check_ms` is the reading; judgeLimit over the five, with each run's load at its start and end, must not
// FAIL, and anything but PASS is INCONCLUSIVE.
import { describe, expect, it } from 'vitest';
import {
  AC, BIG, FORMULA_A, FORMULA_B, FULL, LABEL, RELEASE, TIMEOUT, TITLE_SIZE, blockSvg, brief, buildInto, buildLinux, canonical, coveredFilm, crossingFilm,
  cueEndsSeen, cutFilm, docId, inconclusive, isObject, judge, judgeLimit, linuxMissing, load, none, overlapFilm, putStore, rowsOf, run, runLinux,
  scenarioOf, speedLabel, useBuilds, useFolders, bigFilm, type Film, type JsonObject, type Row,
} from './helpers.ts';

const bin = useBuilds([FULL]);
const folder = useFolders();
const LIMIT_MS = 50;
const RUNS = 5;

/** The SVGs the films import, put into `evidence`: the same bytes, so the same hashes, in every store. */
function svgs(evidence: string): { a: string; b: string; title: string } {
  return { a: putStore(evidence, blockSvg(...FORMULA_A, 'term')), b: putStore(evidence, blockSvg(...FORMULA_B, 'term')), title: putStore(evidence, blockSvg(...TITLE_SIZE, 'words')) };
}
function films(src: { a: string; b: string; title: string }): Film[] {
  return [
    { name: 'the axis line through the label', doc: docId(1), document: crossingFilm(docId(1), speedLabel(false)) },
    { name: 'formulas sharing 6%', doc: docId(2), document: overlapFilm(docId(2), src.a, src.b, 588) },
    { name: 'an opaque rect drawn after a text', doc: docId(3), document: coveredFilm(docId(3), false) },
    { name: 'the title past both edges', doc: docId(4), document: cutFilm(docId(4), src.title) },
    { name: `${BIG.cues} cue ends × ${BIG.texts} texts × ${BIG.strokes} strokes of ${BIG.segments} segments`, doc: docId(5), document: bigFilm(docId(5)) },
  ];
}
/** What film.layout decided on a film, as compared across machines. */
const outcome = (row: Row | undefined): string =>
  row ? canonical({ result: row.result, blocked: row.raw['blocked'] ?? null, issues: row.issues.map((i) => canonical(i.raw)).sort() }) : 'no row';

/** The rows are decided here, so their equality on Linux means something. */
function decidedFailures(rows: Record<string, Row | undefined>, list: readonly Film[]): string[] {
  const failures: string[] = [];
  for (const f of list) {
    const row = rows[f.name];
    if (!row) failures.push(`film.layout's requirement on ${f.name} has no row`);
    else if (row.result !== 'PASS' && row.result !== 'FAIL') failures.push(`film.layout on ${f.name} is ${row.result}, not decided: ${brief(row.raw)}`);
  }
  const crossed = rows[list[0]!.name];
  if (crossed && !crossed.issues.some((i) => i.code === 'layout.crossing' && JSON.stringify(i.raw).includes(LABEL))) failures.push(`film.layout raises no layout.crossing naming ${LABEL} on ${list[0]!.name}`);
  const big = rows[list[4]!.name];
  if (big && big.result !== 'FAIL') failures.push(`film.layout on ${list[4]!.name} is ${big.result}: its waves cross its labels`);
  return failures;
}

/** One fresh release process judging the big film: film.layout's own time on it, after checking it saw every cue end. */
function timedRun(release: string): number {
  const evidence = folder();
  const big: Film = { name: 'the big film', doc: docId(5), document: bigFilm(docId(5)) };
  const row = judge(release, evidence, [big]).rows[big.name];
  expect(row?.result, `film.layout on the big film FAILs: its waves cross its labels: ${brief(row?.raw)}`).toBe('FAIL');
  expect(cueEndsSeen(row!).length, `film.layout checked all ${BIG.cues} cue ends of the big film: some issue lists each in its ts`).toBe(BIG.cues);
  const timing = row!.raw['timing'];
  const ms = isObject(timing) ? timing['check_ms'] : undefined;
  expect(typeof ms === 'number' && Number.isFinite(ms) && ms >= 0, `film.layout's row reports its own time, timing.check_ms: ${brief(timing)}`).toBe(true);
  return ms as number;
}

describe(`${AC[5]} film.layout's results hold on every machine, and a full film checks in under 50 ms`, () => {
  it(`${AC[5]} film.layout gives the same results on macOS and Linux x86_64, and ${BIG.cues} cue ends × ${BIG.texts} texts × ${BIG.strokes} strokes of ${BIG.segments} segments check in under ${LIMIT_MS} ms on the reference Mac`, async () => {
    const open: string[] = [];

    if (process.platform !== 'darwin') open.push(`the macOS half runs on macOS; this is ${process.platform}`);
    else {
      const evidence = folder();
      const list = films(svgs(evidence));
      const mac = rowsOf(run(bin(FULL), scenarioOf(evidence, list)), list);
      none(decidedFailures(mac, list), 'film.layout decides each film on this Mac');
      const missing = linuxMissing();
      if (missing) open.push(`the Linux half: ${missing}`);
      else {
        expect(buildLinux(), 'deep-show builds for Linux x86_64').toBe('');
        const inside = folder();
        svgs(inside);
        const linux = rowsOf(runLinux(scenarioOf(inside, list), inside), list);
        for (const f of list) expect(outcome(linux[f.name]), `film.layout's result on ${f.name} on Linux x86_64 is macOS's`).toBe(outcome(mac[f.name]));
      }
    }

    const now = (): { start: number; end: number }[] => Array.from({ length: RUNS }, () => ({ start: load(), end: load() }));
    const here = await judgeLimit(LIMIT_MS, Array.from({ length: RUNS }, () => 0), now());
    if (here['status'] !== 'PASS') open.push(`the timing: this machine can't judge it now: ${String(here['reason'])}`);
    else {
      const built = buildInto(RELEASE, folder());
      expect(built.error, 'deep-show builds in release').toBe('');
      timedRun(built.bin);
      const runs: number[] = [];
      const loads: { start: number; end: number }[] = [];
      for (let k = 0; k < RUNS; k++) {
        const start = load();
        runs.push(timedRun(built.bin));
        loads.push({ start, end: load() });
      }
      const verdict: JsonObject = await judgeLimit(LIMIT_MS, runs, loads);
      console.log(`#408 film.layout on ${BIG.cues} cue ends × ${BIG.texts} texts × ${BIG.strokes} strokes of ${BIG.segments} segments, check_ms per run: ${runs.map((r) => r.toFixed(2)).join(', ')} → ${String(verdict['status'])}`);
      expect(verdict['status'], `film.layout's time against ${LIMIT_MS} ms: ${JSON.stringify(verdict)}`).not.toBe('FAIL');
      if (verdict['status'] !== 'PASS') open.push(`the timing: ${JSON.stringify(verdict)}`);
    }

    if (open.length) inconclusive(open.join('; '));
  }, 4 * TIMEOUT);
});
