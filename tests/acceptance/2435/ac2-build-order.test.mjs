// #2435 AC2, build order: one mesh, and a second mesh with a new bottom level added at frame 2, drawn 100
// times in each of three forms. A ray from the camera through the added mesh reads a hit or the sky. The
// form the report names for #475 draws it in the frame that adds it every time; a top level built before
// its bottom level reads the sky.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RECORD, count, exitedNotPass, loadRecord, obj, reading, recordPart, recordPlant, runProbe } from './helpers.mjs';

const RUNS = 100;
const ADDED_FRAME = 2;
// Both levels in one build; two builds in one encoder; two command buffers submitted in order.
const FORMS = ['one_build', 'one_encoder', 'two_command_buffers'];
const PLANT = 'top_level_first';

const counted = (m) => obj(m) && m.runs === RUNS && count(m.hit) && count(m.sky) && m.hit + m.sky === RUNS;

test('#2435 AC2 the form the report names for #475 draws the added mesh in the frame that adds it in 100 of 100 runs, with each other form counted', () => {
  const b = recordPart(loadRecord(), 'build_order');
  assert.equal(b.status, 'PASS', `build_order reads ${b.status}: ${b.reason}`);
  assert.equal(b.runs, RUNS, 'build_order: 100 runs of each form');
  assert.equal(b.added_frame, ADDED_FRAME, 'build_order: the second mesh is added at frame 2');
  assert.ok(FORMS.includes(b.form_for_475), `the report names the form #475 takes, one of ${FORMS.join(', ')}: ${JSON.stringify(b.form_for_475)}`);
  for (const f of FORMS) {
    assert.ok(counted(b.forms?.[f]), `${f}: the added mesh's ray at frame 2 reads hit or sky, counted out of 100: ${JSON.stringify(b.forms?.[f])}`);
  }
  const named = b.forms[b.form_for_475];
  assert.equal(named.hit, RUNS, `${b.form_for_475}, the form named for #475, drew the added mesh at frame 2 in ${named.hit} of 100 runs`);
});

function readsSkyNamingFrame(out, shown) {
  assert.equal(out.plant, PLANT, `${shown}: the report is the ${PLANT} plant's`);
  const b = reading(out, 'build_order', shown);
  assert.equal(b.status, 'FAIL', `${shown}: the planted builder reads ${b.status}, not FAIL`);
  assert.equal(out.status, 'FAIL', `${shown}: the run reads ${out.status}, not FAIL`);
  const sky = FORMS.filter((f) => counted(b.forms?.[f]) && b.forms[f].sky > 0);
  assert.ok(sky.length > 0, `${shown}: no form reads the sky at frame 2 with the top level built first: ${JSON.stringify(b.forms)}`);
  assert.match(String(b.reason), /\bframe 2\b/, `${shown}: the FAIL names the frame, frame 2`);
}

test('#2435 AC2 plant: a builder that submits the top level before the bottom level reads the sky and fails, naming the frame, in the report and live', () => {
  readsSkyNamingFrame(recordPlant(loadRecord(), PLANT), `${RECORD} plants.${PLANT}`);
  const run = runProbe(['--part', 'build_order', '--plant', PLANT]);
  readsSkyNamingFrame(run.out, run.shown);
  exitedNotPass(run);
});
