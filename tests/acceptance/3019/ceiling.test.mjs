// AC5: the cache's disk use has a ceiling, and the oldest entries go first once it's reached. Every build here writes
// a 16 MiB dist/blob.bin of its own bytes, and the ceiling (DEEP_BUILD_CACHE_BYTES) is 60 MiB: room for a run's three
// builds (the merge base's, the change's and the twin's), never for four. A first run stores three; main moves, so the
// second run's three builds are of other trees, and storing them must push out the first run's three, the oldest.
import assert from 'node:assert/strict';
import test from 'node:test';
import { builds, cacheOf, diskUse, holding, machineRepo, mainMoves, proof, sandbox, show, TIMEOUT } from './helpers.mjs';

const MIB = 2 ** 20;
const BLOB = 16 * MIB;
const CEILING = 60 * MIB;
const ENV = { DEEP_BUILD_CACHE_BYTES: String(CEILING), FIXTURE_BLOB_BYTES: String(BLOB) };

test('#3019.2e0b1f52 the cache\'s disk use stays under its ceiling, and once it is reached the oldest entries go first', TIMEOUT, async (t) => {
  const box = sandbox(t);
  const fixture = machineRepo(box);
  const held = (result, list) => Object.entries(list).map(([name, build]) => `${name} ${build.marker.slice(0, 12)}: ${holding(box, build.blob).length ? 'held' : 'absent'}`).join(', ') + `; ${diskUse(box)} bytes under ${cacheOf(box)}\n${show(result)}`;

  const old = builds(fixture.worktree, BLOB);
  const first = await proof(box, fixture, { env: ENV });
  assert.ok(diskUse(box) <= CEILING, `after the first run the cache holds ${diskUse(box)} bytes, over its ceiling of ${CEILING}\n${held(first, old)}`);
  for (const [name, build] of Object.entries(old)) assert.ok(holding(box, build.blob).length, `after the first run, with room for three builds, the cache holds no file with the ${name} build's dist/blob.bin\n${held(first, old)}`);

  mainMoves(fixture, { 'packages/w/src/note.txt': 'main moved on\n' }, 'Edit the note');
  const now = builds(fixture.worktree, BLOB);
  const second = await proof(box, fixture, { env: ENV });
  assert.ok(diskUse(box) <= CEILING, `after the second run the cache holds ${diskUse(box)} bytes, over its ceiling of ${CEILING}\n${held(second, { ...prefix('old ', old), ...prefix('new ', now) })}`);
  for (const [name, build] of Object.entries(now)) assert.ok(holding(box, build.blob).length, `after the second run the cache holds no file with its ${name} build's dist/blob.bin, one of the three newest entries\n${held(second, { ...prefix('old ', old), ...prefix('new ', now) })}`);
  for (const [name, build] of Object.entries(old)) assert.equal(holding(box, build.blob).length, 0, `after the second run the cache still holds the first run's ${name} build, one of the oldest entries, past the ceiling's room for three\n${held(second, { ...prefix('old ', old), ...prefix('new ', now) })}`);
});

const prefix = (word, list) => Object.fromEntries(Object.entries(list).map(([name, build]) => [`${word}${name}`, build]));
