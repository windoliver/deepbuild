// #405.17969a94: "Budgets, on the reference Mac in the local preflight, compared with the merge base: the geometry
// audit of a 1,000-part figure takes under 500 ms, and determinism hashing adds under 5% to render time"
//
// Fixtures (helpers.ts `bigFigure`), both shown by the working agent alpha through deep_show:
//   - the 1,000-part figure: a plate and 999 parts on it in 27 rows of 37, 0.04 m boxes, cylinders and spheres in
//     turn, each resting on the plate 0.01 m from its neighbours, except nine planted parts (row 3j + 1, column
//     4j + 2) shifted 0.02 m into their right-hand neighbour. Its claim's one requirement: `{kind: geometry.audit,
//     scope: scene, tolerance: {sunk: 0.003, touch: 0.001, land: 0.001}, support: {floating: [plate]}}`;
//   - the same parts with a camera and a sun, 1920 × 1080, rendered for its claim's one requirement `{kind:
//     document.determinism, at_times: [0 s, 0.5 s, 1 s], compare: same_machine}`.
//
// asserts:
//   - on this machine (debug build), the audit is decided and reads the whole figure: FAIL with exactly the nine
//     planted geometry.overlap errors, each naming its shifted part and that part's neighbour, and nothing else; its
//     row reports `timing.check_ms`. document.determinism PASSes (a still scene: seek equals play) and its row reports
//     `timing.render_ms` and `timing.hash_ms`, each above 0 (no GPU here: that half is INCONCLUSIVE);
//   - the budgets: the perf lane's own judgeLimit (scripts/benchmark.mjs) first says whether this machine can judge a
//     timing now (a reference Mac on mains power, Low Power Mode off, thermal state nominal, the load under the core
//     count); if not, INCONCLUSIVE before a release build. If so, `full` is built in release, one warm-up process runs
//     the scenario, then five fresh processes; each must decide as above, and the five readings are judged:
//     `timing.check_ms` against 500 ms, and 100 × hash_ms ÷ render_ms against 5 (%). Neither may FAIL, and anything
//     but PASS is INCONCLUSIVE, never a pass.
//   - "compared with the merge base": the local preflight's edit guard runs this file on the merge base too, where the
//     audit is BLOCKED `not_run` and fails here (README: Readings).
import { describe, expect, it } from 'vitest';
import {
  BIG_CHECK, BIG_DETERMINISM, BIG_PARTS, BIG_PLANTED, FULL, RELEASE, TIMEOUT, bigFigure, brief, buildInto, claimId, claimOf, docId,
  exactFaultFailures, inconclusive, judgeLimit, load, none, presented, refusalsOf, reqId, rowOf, run, scenarioOf, show, timingOf, useBuilds,
  useFolders, verdict, type JsonObject,
} from './helpers.ts';

/** The criterion's ID: `#405.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#405.17969a94';
const bin = useBuilds([FULL]);
const folder = useFolders();
const AUDIT_MS = 500;
const HASH_PERCENT = 5;
const RUNS = 5;

const [FIGURE, RENDERED] = [docId(1), docId(2)];
const claims = { [claimId(1)]: claimOf(FIGURE, reqId(1), BIG_CHECK), [claimId(2)]: claimOf(RENDERED, reqId(2), BIG_DETERMINISM) };
const calls: JsonObject[] = [show(FIGURE, bigFigure(false)), show(RENDERED, bigFigure(true)), verdict(claimId(1)), verdict(claimId(2))];

/** One fresh `deep-show run`: the audit's own time, and the hashing's share of render time in % (null without a GPU). */
function readings(binary: string): { auditMs: number; hashPercent: number | null } {
  const [shownFigure, shownRendered, onFigure, onRendered] = run(binary, scenarioOf(folder(), [FIGURE, RENDERED], claims, calls));
  presented(shownFigure!, `the ${BIG_PARTS}-part figure`);
  presented(shownRendered!, 'the rendered parts');
  const audit = rowOf(onFigure!, reqId(1), `the ${BIG_PARTS}-part figure`);
  none(exactFaultFailures(audit, BIG_PLANTED, `the geometry audit of the ${BIG_PARTS}-part figure`), 'the audit reads the whole figure: its nine planted overlaps and nothing else');
  const auditMs = timingOf(audit, 'check_ms');
  expect(auditMs, `the audit's row reports its own time, timing.check_ms: ${brief(audit.raw['timing'] ?? null)}`).not.toBeNull();
  const det = rowOf(onRendered!, reqId(2), 'the rendered parts');
  if (det.result === 'BLOCKED' && refusalsOf(det).some((b) => b['code'] === 'gpu_unavailable')) return { auditMs: auditMs!, hashPercent: null };
  expect(det.result, `document.determinism decides the rendered parts, a still scene whose seek equals its play: ${brief(det.raw)}`).toBe('PASS');
  const [renderMs, hashMs] = [timingOf(det, 'render_ms'), timingOf(det, 'hash_ms')];
  expect(renderMs !== null && renderMs > 0 && hashMs !== null && hashMs > 0, `the determinism row reports timing.render_ms and timing.hash_ms, each above 0: ${brief(det.raw['timing'] ?? null)}`).toBe(true);
  return { auditMs: auditMs!, hashPercent: (100 * hashMs!) / renderMs! };
}

describe(`${ID} the geometry audit's and determinism hashing's budgets on the reference Mac`, () => {
  it(`${ID} the geometry audit of a 1,000-part figure takes under 500 ms, and determinism hashing adds under 5% to render time, on the reference Mac`, async () => {
    const open: string[] = [];
    if (readings(bin(FULL)).hashPercent === null) open.push('determinism hashing: this machine has no GPU to render and hash on');

    const now = (): { start: number; end: number }[] => Array.from({ length: RUNS }, () => ({ start: load(), end: load() }));
    const gate = await judgeLimit(AUDIT_MS, Array.from({ length: RUNS }, () => 0), now());
    if (gate['status'] !== 'PASS') open.push(`the timings: this machine can't judge them now: ${String(gate['reason'])}`);
    else {
      const built = buildInto(RELEASE, folder());
      expect(built.error, 'deep-show builds in release').toBe('');
      readings(built.bin);
      const audits: number[] = [];
      const hashes: number[] = [];
      const loads: { start: number; end: number }[] = [];
      for (let k = 0; k < RUNS; k++) {
        const start = load();
        const r = readings(built.bin);
        loads.push({ start, end: load() });
        audits.push(r.auditMs);
        if (r.hashPercent !== null) hashes.push(r.hashPercent);
      }
      const audit = await judgeLimit(AUDIT_MS, audits, loads);
      console.log(`#405 geometry audit of ${BIG_PARTS} parts, check_ms per run: ${audits.map((x) => x.toFixed(2)).join(', ')} → ${String(audit['status'])}`);
      expect(audit['status'], `the audit's time against ${AUDIT_MS} ms: ${JSON.stringify(audit)}`).not.toBe('FAIL');
      if (audit['status'] !== 'PASS') open.push(`the audit's time: ${JSON.stringify(audit)}`);
      if (hashes.length !== RUNS) open.push('determinism hashing: no GPU in the timed runs');
      else {
        const hash = await judgeLimit(HASH_PERCENT, hashes, loads);
        console.log(`#405 determinism hashing, % of render time per run: ${hashes.map((x) => x.toFixed(2)).join(', ')} → ${String(hash['status'])}`);
        expect(hash['status'], `determinism hashing's share of render time against ${HASH_PERCENT}%: ${JSON.stringify(hash)}`).not.toBe('FAIL');
        if (hash['status'] !== 'PASS') open.push(`determinism hashing: ${JSON.stringify(hash)}`);
      }
    }

    if (open.length) inconclusive(open.join('; '));
  }, 4 * TIMEOUT);
});
