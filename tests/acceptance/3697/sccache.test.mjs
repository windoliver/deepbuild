import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { MATCHED, OUT_FOLDER, UNMATCHED, ancestry, begun, cpuOf, dump, firstSample, ledByMargin, logText, reading, redact, sandbox, sccacheClient, sccacheServer, span, tree, warm } from './helpers.mjs';

const darwin = process.platform === 'darwin';
const scene = {};

after(() => scene.box?.close());

before(async () => {
  if (!darwin) return;
  const box = sandbox();
  scene.box = box;
  const holder = sccacheClient(box, MATCHED);
  scene.holder = holder;
  scene.client = await begun(box, 'client', holder, 'build');
  const server = sccacheServer(box, [{ name: 'matched', cores: 2, metadata: MATCHED }, { name: 'unmatched', cores: 2, metadata: UNMATCHED }]);
  scene.server = await begun(box, 'server', server);
  scene.matched = await begun(box, 'matched', server);
  scene.unmatched = await begun(box, 'unmatched', server);
  const warmed = await warm([scene.matched.pid, scene.unmatched.pid], 1.5, 20_000);
  const { sample, readings, run } = await firstSample(box, warmed);
  Object.assign(scene, { sample, readings, run });
  scene.text = logText(box);
  box.stop();
});

function theScene() {
  const { box, holder, client, server, matched, unmatched, sample, readings, run } = scene;
  const say = (text) => `${text}\n${dump(box, run, holder)}`;
  assert.ok(sample, say('load wrote no sample within 60 s'));
  assert.ok(!('failed' in sample), say(`the sample failed: ${sample.failed}`));
  const first = readings.find((procs) => procs.has(client.pid) && procs.has(server.pid) && procs.has(matched.pid) && procs.has(unmatched.pid));
  assert.ok(first, say('no reading of the test\'s own ps saw the client, the server and both compiles at once'));
  assert.equal(first.get(client.pid).command, 'sccache', say('the client isn\'t named sccache as ps prints ucomm'));
  assert.equal(first.get(server.pid).command, 'sccache', say('the server isn\'t named sccache as ps prints ucomm'));
  assert.equal(first.get(matched.pid).command, 'rustc', say('the matching compile isn\'t named rustc as ps prints ucomm'));
  assert.equal(first.get(unmatched.pid).command, 'rustc', say('the other compile isn\'t named rustc as ps prints ucomm'));
  assert.ok(ancestry(first, client.pid).includes(holder.pid), say('the client isn\'t under the stub grant\'s holder'));
  assert.ok(!ancestry(first, server.pid).includes(holder.pid), say('the server is under the stub grant\'s holder'));
  assert.equal(first.get(matched.pid).ppid, server.pid, say('the matching compile isn\'t the server\'s child'));
  assert.equal(first.get(unmatched.pid).ppid, server.pid, say('the other compile isn\'t the server\'s child'));
  const live = readings.filter((procs) => procs.has(holder.pid) && procs.has(matched.pid) && procs.has(unmatched.pid));
  const grantTree = (procs) => tree(procs, holder.pid);
  const ranges = {
    tree: span(live, (procs) => cpuOf(procs, grantTree(procs))),
    matched: span(live, (procs) => cpuOf(procs, [matched.pid])),
    unmatched: span(live, (procs) => cpuOf(procs, [unmatched.pid])),
    owed: span(live, (procs) => cpuOf(procs, [...grantTree(procs), matched.pid])),
  };
  assert.deepEqual(sample.grants?.map(({ id, class: cls, pid }) => ({ id, class: cls, pid })), [{ id: client.id, class: 'build', pid: holder.pid }], say('the sample\'s grants aren\'t exactly the stub build grant, by its ID and its holder\'s pid'));
  return { box, say, live, ranges, grant: sample.grants[0], sample, matched, unmatched, client };
}

const starved = (live, ranges, which) => (ranges[which].lo < 1 ? `INCONCLUSIVE (reading only: the ${which} compile read ${ranges[which].lo.toFixed(2)} cores at its least, under 1, so a right attribution can't be told from none within 0.5)` : null);
const fmt = ({ lo, hi }) => `${lo.toFixed(2)} to ${hi.toFixed(2)}`;

test('#3697.68094266 a compile the sccache server runs counts under the grant whose sccache client carries the same -C metadata and --out-dir, and top names it with that ID', { skip: !darwin && 'INCONCLUSIVE: macOS only (ps ucomm, a copy of node named sccache and rustc)', timeout: 180_000 }, (t) => {
  const { say, live, ranges, grant, sample, matched, client } = theScene();
  const skip = starved(live, ranges, 'matched');
  if (skip) return t.skip(skip);
  assert.ok(grant.cpu >= ranges.owed.lo - 0.5 && grant.cpu <= ranges.owed.hi + 0.5, say(`the grant ${client.id}'s cpu is ${grant.cpu}; the test's own ps read the grant's tree and the matching compile the server runs at ${fmt(ranges.owed)} cores around the sample, so it must be within 0.5 of that`));
  assert.ok(grant.compile >= ranges.matched.lo - 0.5 && grant.compile <= ranges.matched.hi + 0.5 + ranges.tree.hi, say(`the grant ${client.id}'s compile is ${grant.compile}; the test's own ps read the matching rustc at ${fmt(ranges.matched)} cores`));
  const entry = sample.top?.find((proc) => proc.pid === matched.pid);
  if (entry) {
    assert.equal(entry.grant, client.id, say(`top lists the matching rustc (pid ${matched.pid}) under ${entry.grant ?? 'no grant'}, not the grant ${client.id}`));
    assert.equal(entry.command, 'rustc', say('top names the matching compile other than rustc'));
    assert.ok(entry.cpu >= ranges.matched.lo - 0.5 && entry.cpu <= ranges.matched.hi + 0.5, say(`top reads the matching rustc at ${entry.cpu}; the test's own ps read ${fmt(ranges.matched)}`));
    return;
  }
  assert.ok(!ledByMargin(live, matched.pid), say(`top doesn't list the matching rustc (pid ${matched.pid}), though it led all but four processes by 0.5 of a core in every reading`));
  t.skip('INCONCLUSIVE (reading only: the matching rustc wasn\'t among the five processes that used most, and didn\'t lead all but four by 0.5 of a core, so top needn\'t name it)');
});

test('#3697.feb07461 a second compile of that server with another -C metadata value counts in outside, not under the grant', { skip: !darwin && 'INCONCLUSIVE: macOS only (ps ucomm, a copy of node named sccache and rustc)', timeout: 180_000 }, (t) => {
  const { say, live, ranges, grant, sample, unmatched, client } = theScene();
  const skip = starved(live, ranges, 'matched') ?? starved(live, ranges, 'unmatched');
  if (skip) return t.skip(skip);
  assert.ok(grant.cpu >= ranges.owed.lo - 0.5, say(`precondition: the grant ${client.id}'s cpu is ${grant.cpu}, so the matching compile the server runs isn't counted under it (the test's own ps read the grant's tree and that compile at ${fmt(ranges.owed)}); a sampler that sends no compile to a grant can't be told from one that sends the right one`));
  assert.ok(grant.cpu <= ranges.owed.hi + 0.5, say(`the grant ${client.id}'s cpu is ${grant.cpu}; the test's own ps read the grant's tree and the matching compile at ${fmt(ranges.owed)}, and the compile with -C metadata=${UNMATCHED} at ${fmt(ranges.unmatched)}, which goes to outside`));
  assert.ok(sample.outside?.cpu >= ranges.unmatched.lo - 0.5, say(`outside's cpu is ${sample.outside?.cpu}; the other compile alone read ${fmt(ranges.unmatched)}`));
  assert.ok(sample.outside?.compile >= ranges.unmatched.lo - 0.5, say(`outside's compile is ${sample.outside?.compile}; the other rustc alone read ${fmt(ranges.unmatched)}`));
  const entry = sample.top?.find((proc) => proc.pid === unmatched.pid);
  if (entry) {
    assert.equal(entry.grant, undefined, say(`top lists the other rustc (pid ${unmatched.pid}) under the grant ${entry.grant}; it counts in outside`));
    return;
  }
  assert.ok(!ledByMargin(live, unmatched.pid), say(`top doesn't list the other rustc (pid ${unmatched.pid}), though it led all but four processes by 0.5 of a core in every reading`));
});

test('#3697.5c604981 the log a sample of the first criterion writes holds neither the metadata hash nor the out-dir folder', { skip: !darwin && 'INCONCLUSIVE: macOS only (ps ucomm, a copy of node named sccache and rustc)', timeout: 180_000 }, (t) => {
  const { box, say, live, ranges, grant, client } = theScene();
  const skip = starved(live, ranges, 'matched');
  if (skip) return t.skip(skip);
  assert.ok(grant.cpu >= ranges.owed.lo - 0.5, say(`precondition: the grant ${client.id}'s cpu is ${grant.cpu}, so the sample didn't match the compile to its client (the test's own ps read the grant's tree and that compile at ${fmt(ranges.owed)}); a log of a sample that read no argument can't hold one`));
  const text = scene.text;
  for (const [what, mark] of [['the matching -C metadata hash', MATCHED], ['the other -C metadata hash', UNMATCHED], ['the out-dir folder', box.outDir], ['the out-dir folder\'s name', OUT_FOLDER]]) {
    assert.ok(!text.includes(mark), say(`load.log holds ${what} (${redact(box, mark)})`));
  }
});
