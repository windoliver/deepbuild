// #3296 AC4 (#3296.870c9548): a kept result is used only under its own key: another tree, host, platform,
// operating-system build, Node version, Rust version or DEEP_*/DEEPBUILD_* environment each run the file again.
//
// Each part is planted on the kept lines: one whole run, then each part of the key changed on the line of one job, a part
// a job, so a program that ignores a part is told by that job's file, which it doesn't start. First on seven alone groups,
// then on the jobs the unit lane runs itself and the timed block. A job whose line wasn't changed is the control: it isn't
// started. What can be changed for real between two runs is changed in key-real.test.mjs.
//
// The merge base keeps no line, and is the planted program that starts the control again.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import test, { before } from 'node:test';
import { aloneFile, dump, nameOf, nodeFile, parallelFile, scene, timedFile, toEnd } from './helpers.mjs';

const AC4 = '#3296.870c9548';
const PARTS = ['tree', 'host', 'platform', 'os', 'node', 'rust', 'env'];
const FILES = {
  [parallelFile('p')]: 'p', ...Object.fromEntries(PARTS.map((part, k) => [aloneFile(k, 'a'), `${part} changed`])),
  [aloneFile(PARTS.length, 'a')]: 'control', [timedFile()]: 't', [nodeFile('n')]: 'n',
};
const fileOf = (name) => Object.keys(FILES).find((file) => FILES[file] === name) ?? name;
// The jobs the unit lane runs itself, and the timed block, each with a part a run.
const ROUNDS = [{ p: 'tree', 'cargo test': 'host', n: 'platform', t: 'os' }, { p: 'node', 'cargo test': 'rust', n: 'env', t: 'tree' }];

let box;
const runs = {};
let key;

before(async () => {
  box = scene({ files: FILES });
  const step = async (name) => {
    const earlier = box.counts(), run = await toEnd(box), counts = box.counts();
    runs[name] = { ...run, started: box.names().filter((probe) => counts[probe] !== earlier[probe]), counts, record: box.record(), kept: box.kept(), shown: dump(box, run) };
  };
  const holds = (line, name) => (line.tests ?? []).some(({ id }) => nameOf(box, id) === name);
  const other = (line, part) => ({ ...line, key: { ...line.key, [part]: part === 'tree' ? 'f'.repeat(40) : `another ${line.key?.[part]}` } });
  /** The kept lines with a part of the key changed on the lines of the probes `changes` names. */
  const change = (changes) => {
    if (box.kept().length) box.keep(box.kept().map((line) => Object.entries(changes).reduce((now, [name, part]) => (holds(line, name) ? other(now, part) : now), line)));
  };
  await step('first');
  key = runs.first.kept[0]?.key;
  change(Object.fromEntries(PARTS.map((part) => [`${part} changed`, part])));
  // What a line of another machine says is no more use when it reads FAIL: it doesn't stand here.
  const control = box.kept().find((line) => holds(line, 'control'));
  if (control) box.keep([...box.kept(), { ...other(control, 'host'), tests: control.tests.map(({ id }) => ({ id, state: 'FAIL', note: 'a planted failure' })) }]);
  await step('alone');
  for (const [k, round] of ROUNDS.entries()) {
    change(round);
    await step(`own ${k}`);
  }
}, { timeout: 60 * 60_000 });

/** A digest of the variables that takes no secret, in the ways a program might write one. */
function unkeyed(env) {
  const entries = Object.entries(env).filter(([name]) => /^(?:DEEP|DEEPBUILD)_/.test(name));
  const sorted = [...entries].sort(([a], [b]) => (a < b ? -1 : 1));
  const texts = [entries, sorted].flatMap((list) => [JSON.stringify(list), JSON.stringify(Object.fromEntries(list)), ...['\n', '\0', ';', ' ', ''].flatMap((glue) => { const text = list.map(([name, value]) => `${name}=${value}`).join(glue); return [text, `${text}${glue}`]; })]);
  return texts.flatMap((text) => ['sha256', 'sha1', 'sha512', 'md5'].flatMap((kind) => ['hex', 'base64', 'base64url'].map((form) => createHash(kind).update(text).digest(form))));
}

test(`${AC4} every kept line names its tree, host, platform, operating-system build, Node and Rust version and a digest of its environment that gives no value away`, () => {
  const { kept, shown } = runs.first;
  assert.ok(kept.length, `the run kept no line\n${shown}`);
  for (const line of kept) assert.deepEqual(line.key, key, `two lines of one run have two keys\n${shown}`);
  for (const part of PARTS) assert.ok(typeof key[part] === 'string' && key[part], `the key has no ${part}: ${JSON.stringify(key)}`);
  assert.equal(key.tree, box.hash());
  assert.equal(key.host, hostname());
  assert.equal(key.platform, `${process.platform}-${process.arch}`);
  assert.ok(key.node.includes(process.versions.node), `node: ${key.node}`);
  assert.equal(key.rust, readFileSync(join(box.state, 'rustc'), 'utf8').trim(), 'rust isn\'t the compiler\'s version line');
  const build = process.platform === 'darwin' ? spawnSync('sw_vers', ['-buildVersion'], { encoding: 'utf8' }).stdout.trim() : '';
  assert.ok(key.os.includes(build), `os: ${key.os}, and the operating-system build is ${build}`);
  const text = readFileSync(box.keptFile(), 'utf8');
  for (const name of ['DEEP_THROTTLE_TABLE', 'DEEP_TEST_SHARD_FLOOR']) assert.ok(!text.includes(name) && (box.env[name].length < 4 || !text.includes(box.env[name])), `the kept lines hold ${name} or its value\n${shown}`);
  const digest = unkeyed(box.env).find((known) => key.env.includes(known) || (key.env.length >= 8 && known.startsWith(key.env)));
  assert.equal(digest, undefined, `the environment's digest takes no secret: it is ${digest}`);
});

test(`${AC4} an alone group's line with one part of its key changed isn't used: its file runs again, for each part, and a line unchanged is used`, () => {
  const { first, alone } = runs;
  for (const name of box.names()) assert.equal(first.counts[name], 1, `${fileOf(name)} was started ${first.counts[name]} times by the first run\n${first.shown}`);
  assert.ok(!alone.started.includes('control'), `${fileOf('control')}, kept under the run's own key, was run again\n${alone.shown}`);
  for (const part of PARTS) assert.ok(alone.started.includes(`${part} changed`), `a kept line with another ${part} was used: ${fileOf(`${part} changed`)} wasn't run again\n${alone.shown}`);
  assert.deepEqual([...alone.started].sort(), PARTS.map((part) => `${part} changed`).sort(), `the run started other jobs than those whose lines were changed\n${alone.shown}`);
  // The FAIL another host kept for the control stands there and not here.
  assert.equal(alone.record?.state, 'PASS', `a FAIL kept under another key counted: the lane reads ${alone.record?.state}\n${alone.shown}`);
  assert.deepEqual(alone.record.tests.map(({ id }) => id).sort(), box.ids(), `the record of the run in which seven files ran again doesn't hold every test's row once\n${alone.shown}`);
});

test(`${AC4} a line of the parallel block, cargo test, node --test or the timed block with one part of its key changed isn't used: its job runs again`, () => {
  for (const [k, round] of ROUNDS.entries()) {
    const run = runs[`own ${k}`];
    assert.ok(!run.started.includes('control'), `${fileOf('control')}, kept under the run's own key, was run again\n${run.shown}`);
    for (const [name, part] of Object.entries(round)) assert.ok(run.started.includes(name), `a kept line with another ${part} was used: ${fileOf(name)} wasn't run again\n${run.shown}`);
    assert.deepEqual([...run.started].sort(), Object.keys(round).sort(), `the run started other jobs than those whose lines were changed\n${run.shown}`);
    assert.equal(run.record?.state, 'PASS', `the lane reads ${run.record?.state}\n${run.shown}`);
    assert.equal(run.code, 0, `the preflight exited ${run.code}\n${run.shown}`);
  }
});
