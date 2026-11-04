// AC1 (a second run of the same tree compiles 0 crates) and AC8 (bay-target size is a reading).
import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { bays, bytesUnder, expectedGreeting, finished, inBay, machineRepo, sandbox, show, step } from './helpers.mjs';

test('#1117.e77894d3 a second run of the same tree in a bay compiles 0 crates, at the same fixed path, and its tests see this tree\'s binary', { timeout: 600_000 }, async (t) => {
  const box = sandbox(t);
  const { worktree, bays: script } = machineRepo(box);
  const first = bays(box, { script, cwd: worktree, steps: [{ do: 'build' }] });
  const one = inBay(box, await finished(first), first);
  const built = step(one.probe, 'build');
  assert.equal(built.build.status, 0, `the first build failed in the bay\n${built.build.stderr}`);
  assert.equal(built.test.status, 0, `cargo test failed in the bay on the first run\n${built.test.output}`);

  const second = bays(box, { script, cwd: worktree, steps: [{ do: 'build' }] });
  const result = await finished(second);
  const two = inBay(box, result, second);
  assert.equal(two.bay, one.bay, 'the second run of the same tree used another bay path, so nothing it built before could be reused');
  const again = step(two.probe, 'build');
  assert.equal(again.build.status, 0, `the second build failed\n${again.build.stderr}`);
  assert.ok(again.artifacts.length >= 3, `cargo reported ${again.artifacts.length} artifacts; the fixture has a lib, a bin and a test\n${show(result, two.probe)}`);
  const compiled = again.artifacts.filter((artifact) => !artifact.fresh);
  assert.deepEqual(compiled.map(({ name, kind }) => `${name} (${kind})`), [], `the second run of the same tree compiled crates (cargo's own fresh flags)`);
  assert.deepEqual([...again.build.compiling, ...again.test.compiling], [], 'cargo printed Compiling lines on the second run of the same tree');
  // A target warm from another path would pass the line above and still fail here: CARGO_MANIFEST_DIR and
  // CARGO_BIN_EXE_greet are baked at build time (the relocated-target twin).
  assert.equal(again.test.status, 0, `cargo test failed on the second run: its binaries are not this tree's\n${again.test.output}`);
  assert.equal(again.greet, expectedGreeting(worktree), 'the warm binary does not print what the tree holds');
});

test('#1117.f25af808 bay-target size is a reading: the release record carries the bytes of <bay>/target, empty before a build and full after', { timeout: 600_000 }, async (t) => {
  const box = sandbox(t);
  const { worktree, bays: script } = machineRepo(box);
  const empty = bays(box, { script, cwd: worktree, steps: [] });
  const before = inBay(box, await finished(empty), empty);
  assert.ok(before.release, `bays.mjs printed no "BAY release {…}" line\n${show(await empty.done)}`);
  assert.ok(Number.isFinite(before.release.targetBytes) && before.release.targetBytes >= 0, `the release record's targetBytes is ${JSON.stringify(before.release.targetBytes)}, not a number of bytes`);

  const full = bays(box, { script, cwd: worktree, steps: [{ do: 'build' }] });
  const result = await finished(full);
  const after = inBay(box, result, full);
  assert.equal(step(after.probe, 'build').build.status, 0, `the build failed in the bay\n${show(result, after.probe)}`);
  assert.ok(after.release, `bays.mjs printed no "BAY release {…}" line\n${show(result)}`);
  const reading = after.release.targetBytes;
  const measured = bytesUnder(join(after.bay, 'target'));
  assert.ok(measured > 1_000_000, `the fixture's build left only ${measured} bytes in <bay>/target`);
  assert.ok(Number.isFinite(reading), `the release record's targetBytes is ${JSON.stringify(reading)}, not a number\n${show(result)}`);
  assert.ok(reading >= measured / 2 && reading <= measured * 2, `the reading ${reading} is not the size of <bay>/target (${measured} bytes, each file once)`);
  assert.ok(before.release.targetBytes < reading / 10, `the reading before any build (${before.release.targetBytes}) is not below a tenth of the reading after one (${reading})`);
});
