// #3035: the import job's import.document holds each world of a document to the physics module's check, which the
// document check leaves to it (canvas primitives: Asset job: imports, As built). A robot description's document
// passes, and the same document with one body's centre of mass moved outside its shapes fails, naming the body.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import register from '../packages/jobs/import/index.ts';

const fixture = (name) => readFileSync(new URL(`../packages/jobs/import/fixtures/${name}`, import.meta.url), 'utf8');
const b64 = (text) => Buffer.from(text).toString('base64');

test('import.document fails a document whose world the physics check refuses, naming where', async () => {
  const checks = {};
  await register({ registerCheck: (name, run) => { checks[name] = run; }, registerJob: () => {}, registerJobTool: () => {} });
  const run = (document) => checks['import.document']({ outputs: { document: b64(document), look: b64(fixture('robot.look.json')) } });

  const right = await run(fixture('arm.document.json'));
  assert.equal(right.outcome, 'passed', JSON.stringify(right.failures));

  const moved = JSON.parse(fixture('arm.document.json'));
  moved.worlds.two_link_arm.bodies.fore.centre_of_mass = [9, 9, 9];
  const wrong = await run(JSON.stringify(moved));
  assert.equal(wrong.outcome, 'failed');
  assert.match(wrong.failures[0].message, /worlds\/two_link_arm\/bodies\/fore\/centre_of_mass/);
});
