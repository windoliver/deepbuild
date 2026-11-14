// #2435 AC1, candidates: an opaque floor under a layer of 10,000 triangles whose alpha mask passes half of
// each, and 1,000,000 rays straight down, each answer compared with a CPU reference in f64. The form the
// report names for #475 finds what the reference finds for every ray; a traversal that ends a ray at a
// failed candidate loses the floor behind it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RECORD, count, exitedNotPass, loadRecord, names, obj, reading, recordPart, recordPlant, runProbe } from './helpers.mjs';

const RAYS = 1_000_000;
const TRIANGLES = 10_000;
const FORMS = ['candidate_loop', 'opaque_restart'];
const PLANT = 'end_on_failed_candidate';

test('#2435 AC1 the form the report names for #475 finds the floor and the layer wherever the CPU reference does: 0 misses and 0 extra hits in 1,000,000, with the other form counted', () => {
  const c = recordPart(loadRecord(), 'candidates');
  assert.equal(c.status, 'PASS', `candidates reads ${c.status}: ${c.reason}`);
  assert.equal(c.rays, RAYS, 'candidates: 1,000,000 rays');
  assert.equal(c.layer_triangles, TRIANGLES, 'candidates: a layer of 10,000 triangles');
  const ref = c.reference;
  assert.ok(
    obj(ref) && count(ref.floor) && count(ref.layer) && ref.floor > 0 && ref.layer > 0 && ref.floor + ref.layer === RAYS,
    `the CPU reference's answers are the floor or the layer, each for some rays, 1,000,000 in all: ${JSON.stringify(ref)}`,
  );
  assert.ok(FORMS.includes(c.form_for_475), `the report names the form #475 takes, one of ${FORMS.join(', ')}: ${JSON.stringify(c.form_for_475)}`);
  for (const f of FORMS) {
    const m = c.forms?.[f];
    assert.ok(obj(m), `the report has no counts for the ${f} form`);
    assert.equal(m.rays, RAYS, `${f}: counted over 1,000,000 rays`);
    assert.ok(count(m.misses) && count(m.extra_hits) && m.misses + m.extra_hits <= RAYS, `${f}: misses and extra hits are counts out of 1,000,000: ${JSON.stringify(m)}`);
  }
  const named = c.forms[c.form_for_475];
  assert.equal(named.misses, 0, `${c.form_for_475}, the form named for #475, missed ${named.misses} rays`);
  assert.equal(named.extra_hits, 0, `${c.form_for_475}, the form named for #475, made ${named.extra_hits} extra hits`);
});

function failsNamingMisses(out, shown) {
  assert.equal(out.plant, PLANT, `${shown}: the report is the ${PLANT} plant's`);
  const c = reading(out, 'candidates', shown);
  assert.equal(c.status, 'FAIL', `${shown}: the planted traversal reads ${c.status}, not FAIL`);
  assert.equal(out.status, 'FAIL', `${shown}: the run reads ${out.status}, not FAIL`);
  const missed = FORMS.map((f) => c.forms?.[f]?.misses).filter((n) => count(n) && n > 0);
  assert.ok(missed.length > 0, `${shown}: the planted traversal reads no misses: ${JSON.stringify(c.forms)}`);
  assert.ok(missed.some((n) => names(c.reason, n)), `${shown}: the FAIL names the miss count (${missed.join(' or ')}): ${JSON.stringify(c.reason)}`);
}

test('#2435 AC1 plant: a traversal that ends a ray when a candidate fails its test reads misses above 0 and fails, naming the count, in the report and live', () => {
  failsNamingMisses(recordPlant(loadRecord(), PLANT), `${RECORD} plants.${PLANT}`);
  const run = runProbe(['--part', 'candidates', '--plant', PLANT]);
  failsNamingMisses(run.out, run.shown);
  exitedNotPass(run);
});
