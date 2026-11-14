// #2435 AC3, ties: two quads on the same four vertices, one opaque and emitting 100 cd/m², one alpha-masked
// and clear over half its area, above a diffuse floor; 100,000 rays in each of 10 runs. The form the report
// names gives one hash and the floor's irradiance within 1% of the CPU reference; a build that lets the
// masked quad answer first hides half the panel.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RECORD, exitedNotPass, finite, loadRecord, obj, reading, recordPart, recordPlant, runProbe } from './helpers.mjs';

const RUNS = 10;
const RAYS = 100_000;
// The pinned layer as built, or the rule #475's scene build takes for a surface on another's vertices.
const FORMS = ['as_built', 'merge', 'order'];
const PLANT = 'masked_answers_first';

function tenHashes(hashes, what) {
  assert.ok(Array.isArray(hashes) && hashes.length === RUNS, `${what}: one hash per run, 10 in all: ${JSON.stringify(hashes)}`);
  for (const h of hashes) assert.ok(typeof h === 'string' && /^[0-9a-f]{16,}$/i.test(h), `${what}: each hash is hex of at least 64 bits: ${JSON.stringify(h)}`);
  return new Set(hashes.map((h) => h.toLowerCase()));
}

function irradiance(t, what) {
  const i = t.irradiance;
  assert.ok(obj(i) && finite(i.gpu) && finite(i.reference) && i.reference > 0, `${what}: the floor's irradiance from the panel, traced and from the CPU reference: ${JSON.stringify(i)}`);
  return i;
}

test('#2435 AC3 ten runs of the form the report names give one hash of the 100,000 answers, and the floor\'s irradiance is within 1% of the CPU reference', () => {
  const t = recordPart(loadRecord(), 'ties');
  assert.equal(t.status, 'PASS', `ties reads ${t.status}: ${t.reason}`);
  assert.equal(t.runs, RUNS, 'ties: 10 runs');
  assert.equal(t.rays, RAYS, 'ties: 100,000 rays a run');
  assert.ok(FORMS.includes(t.form_for_475), `the report names the form #475 takes, one of ${FORMS.join(', ')}: ${JSON.stringify(t.form_for_475)}`);
  // The pinned layer's own hashes are always reported; where it can't give one hash, the report says so
  // by them and names the rule, and the rule's ten runs are the ones that must agree.
  const asBuilt = tenHashes(t.as_built?.hashes, 'as_built');
  const named = t.form_for_475 === 'as_built' ? asBuilt : tenHashes(t.with_rule?.hashes, `with_rule (${t.form_for_475})`);
  assert.equal(named.size, 1, `${t.form_for_475}: ten runs gave ${named.size} different hashes`);
  const i = irradiance(t, 'ties');
  assert.ok(Math.abs(i.gpu - i.reference) <= 0.01 * i.reference, `the floor's irradiance ${i.gpu} is not within 1% of the CPU reference's ${i.reference}`);
});

function readsAboutHalf(out, shown) {
  assert.equal(out.plant, PLANT, `${shown}: the report is the ${PLANT} plant's`);
  const t = reading(out, 'ties', shown);
  assert.equal(t.status, 'FAIL', `${shown}: the planted build reads ${t.status}, not FAIL`);
  assert.equal(out.status, 'FAIL', `${shown}: the run reads ${out.status}, not FAIL`);
  const i = irradiance(t, shown);
  const ratio = i.gpu / i.reference;
  assert.ok(ratio >= 0.4 && ratio <= 0.6, `${shown}: with the masked quad answering first the floor reads ${ratio.toFixed(3)} of the reference's irradiance, not about half`);
}

test('#2435 AC3 plant: a build that lets the masked quad answer first reads about half the irradiance and fails, in the report and live', () => {
  readsAboutHalf(recordPlant(loadRecord(), PLANT), `${RECORD} plants.${PLANT}`);
  const run = runProbe(['--part', 'ties', '--plant', PLANT]);
  readsAboutHalf(run.out, run.shown);
  exitedNotPass(run);
});
