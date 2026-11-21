// #2401 AC2: "The reading gives window percent per million tokens for each label with its range over the runs, and
// their ratio. With fewer than 15 kept runs on either side it reads INCONCLUSIVE and gives no ratio". Scope: both
// windows are read, the 5-hour and the weekly; the rule, written before the runs, decides on the reading.
// Every number is recomputed from the runs on the record and held to the record's own (invariant 1).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AC, LABELS, MIN_KEPT, OUTCOMES, RECORD, WINDOWS, close, loadRecord, obj, outcome, recompute, runs } from './helpers.mjs';

const fmt = (x) => JSON.stringify(x);

function matches(stated, want, at) {
  assert.ok(obj(stated), `${at}: no reading`);
  assert.equal(stated.status, want.status, `${at}: status reads ${fmt(stated.status)}; the runs give ${want.status} (kept: default ${want.default.runs.length}, deepbuild ${want.deepbuild.runs.length}, at least ${MIN_KEPT} each)`);
  for (const label of LABELS) {
    const s = stated[label], w = want[label];
    assert.ok(obj(s), `${at}.${label}: no reading for the label`);
    assert.deepEqual(s.runs, w.runs, `${at}.${label}.runs: the kept runs behind the reading`);
    if (want.status === 'INCONCLUSIVE' && (s.pct_per_mtok === null || s.pct_per_mtok === undefined)) continue;
    assert.ok(close(s.pct_per_mtok, w.pct_per_mtok), `${at}.${label}.pct_per_mtok reads ${fmt(s.pct_per_mtok)}; the runs give ${w.pct_per_mtok}`);
    assert.ok(Array.isArray(s.range) && close(s.range[0], w.range[0]) && close(s.range[1], w.range[1]), `${at}.${label}.range reads ${fmt(s.range)}; the runs give ${fmt(w.range)}`);
  }
  if (want.status === 'INCONCLUSIVE') {
    assert.ok(stated.ratio === null || stated.ratio === undefined, `${at}: INCONCLUSIVE gives no ratio, but reads ${fmt(stated.ratio)}`);
  } else {
    assert.ok(close(stated.ratio, want.ratio), `${at}.ratio (default over deepbuild) reads ${fmt(stated.ratio)}; the runs give ${want.ratio}`);
    assert.equal(stated.ranges_apart, want.ranges_apart, `${at}.ranges_apart reads ${fmt(stated.ranges_apart)}; the ranges ${fmt(want.default.range)} and ${fmt(want.deepbuild.range)} give ${want.ranges_apart}`);
  }
}

test(`${AC[2]} the reading gives window percent per million tokens per label with its range over the kept runs and their ratio, for the 5-hour and the weekly window, as the runs give it; under 15 kept on a side it reads INCONCLUSIVE with no ratio`, () => {
  const r = loadRecord();
  const list = runs(r);
  assert.ok(obj(r.reading) && typeof r.reading.date === 'string' && /^\d{4}-\d\d-\d\d$/.test(r.reading.date), `${RECORD}: reading.date, the reading's day (YYYY-MM-DD): ${fmt(r.reading?.date)}`);
  const want = {};
  for (const w of WINDOWS) matches(r.reading[w], (want[w] = recompute(r, list, w)), `${RECORD} reading.${w}`);
  const decided = outcome(want.five_hour);
  assert.ok(OUTCOMES.includes(r.reading.outcome), `${RECORD}: reading.outcome is ${OUTCOMES.join(' or ')}: ${fmt(r.reading.outcome)}`);
  assert.equal(r.reading.outcome, decided, `${RECORD}: by the rule written before the runs (ratio under 1.25 or the ranges overlapping: not set; 1.25 or more with the ranges apart: offered and off), the 5-hour reading (${want.five_hour.status}, ratio ${want.five_hour.ratio}, ranges apart ${want.five_hour.ranges_apart}) gives ${decided}`);
  // The reading is right, but an INCONCLUSIVE reading is no measurement: it proves nothing about the gap (#1115).
  if (want.five_hour.status === 'INCONCLUSIVE') {
    throw new Error(`INCONCLUSIVE: the 5-hour reading kept ${want.five_hour.default.runs.length} default and ${want.five_hour.deepbuild.runs.length} deepbuild runs, under ${MIN_KEPT} on a side, so it gives no ratio; the measurement must run again`);
  }
});
