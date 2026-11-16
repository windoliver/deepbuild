// AC1 #1636.d6af27c1: "The same params and seed build the same vertex hash on macOS arm64 and Linux x86_64 and with 1,
// 4 and 8 threads, and the vertex count equals the bound computed before the build"
//
// The fixture tree (helpers.ts `FIXTURE`: seed 1636, 4 levels, 3 children a fork, 8 sides, 8 rings, 6 cards a twig),
// shown by the working agent through deep_show, then in the same process `geometry` with `estimate_only` (the bound
// from the params, nothing built: `builds` 0) and `geometry` with `timings` (the tree built afresh on the session's
// pool, README: Assumed surfaces 5). The vertex hash is SHA-256 of every vertex's position and normal as little-endian
// f64, in order, then the indices as u32 (README: Readings).
//   - First test, this machine: one process each with the scenario's `threads` at 1, 4 and 8. Each build's vertex count
//     equals the bound its `estimate_only` declared, the tree has the fixture's 40 branches, and the three hashes are
//     equal; a difference names the first differing vertex.
//   - Second test, two machines: this arm64 Mac and Linux x86_64 in a linux/amd64 container on it (README: Run them),
//     each `full` deep-show from this checkout, the container with no network, with 1, 4 and 8 threads there too: every
//     hash equals this Mac's. Off an arm64 Mac, without Docker or without the build image, it fails BLOCKED with one
//     unblock ask, never passes. The Mac half runs first, so the base fails it before Docker is touched.
// Wrong programs: the base (no tree@1); a build seeded by thread order, the clock or the process; a platform libm or a
// fused multiply-add on one architecture; a bound that leaves out the cards or the rings' seams.
import { describe, expect, it } from 'vitest';
import {
  AC, FIXTURE, TIMEOUT, blocked, buildLinux, declaredOf, docId, firstDifference, geometry, linuxBlocked, none, presented, runLinux, runShow,
  scenario, show, topologyFailures, treeItem, treeRow, treesDoc, useBins, useFolders, vertexHash, type JsonObject, type TreeRow,
} from './helpers.ts';

const ID = AC[1];
const NAME = `AC1 ${ID}`;
const bin = useBins(['deep-show']);
const folder = useFolders();
const DOC = docId(1);
const THREADS = [1, 4, 8] as const;
const MAC = 'macOS arm64';
const LINUX = 'Linux x86_64';
const calls = (): JsonObject[] => [show(DOC, treesDoc({ tree: treeItem(FIXTURE) })), geometry(DOC, ['tree'], { estimate_only: true }), geometry(DOC, ['tree'], { timings: true })];

/** One machine's build with `threads`: presented, its count equal to its bound, the fixture's shape. */
function judged(replies: JsonObject[], where: string): TreeRow {
  presented(replies[0]!, `the fixture tree on ${where}`);
  const bound = declaredOf(replies[1]!, 'tree', `the bound on ${where}`);
  const row = treeRow(replies[2]!, 'tree', `the build on ${where}`);
  expect(row.positions.length, `on ${where} the vertex count equals the bound computed before the build`).toBe(bound);
  none(topologyFailures(row, FIXTURE), `on ${where} the fixture tree has its 40 branches and 13 forks`);
  return row;
}

describe(`${NAME} one params and seed, one vertex hash`, () => {
  it(`${NAME} with 1, 4 and 8 threads the fixture builds the same vertex hash, each count equal to the bound computed before the build`, () => {
    const builds = THREADS.map((threads) => judged(runShow(bin('deep-show'), scenario(folder(), [DOC], calls(), { threads })), `${MAC} with ${threads} threads`));
    const hashes = builds.map(vertexHash);
    console.log(`${ID} vertex hashes on ${MAC}: ${THREADS.map((t, k) => `${t} threads ${hashes[k]}`).join(', ')}`);
    builds.slice(1).forEach((b, k) => expect(hashes[k + 1], `${THREADS[k + 1]} threads build the hash of 1 thread: ${firstDifference(builds[0]!, b)}`).toBe(hashes[0]));
  }, 3 * TIMEOUT);

  it(`${NAME} macOS arm64 and Linux x86_64 build the same vertex hash, each with 1, 4 and 8 threads`, () => {
    if (process.platform !== 'darwin' || process.arch !== 'arm64') blocked(`this is ${process.platform} ${process.arch}; the first machine is the arm64 reference Mac`, 'run this file on the reference Mac');
    const mac = judged(runShow(bin('deep-show'), scenario(folder(), [DOC], calls(), { threads: 4 })), `${MAC} with 4 threads`);
    const missing = linuxBlocked();
    if (missing) blocked(`${MAC} built hash ${vertexHash(mac)}, but ${LINUX} can't run here: ${missing.reason}`, missing.ask);
    const built = buildLinux();
    if (built.error && built.crashes === 2) blocked(`the emulated ${LINUX} build crashed three times on a signal: ${built.error}`, 'run this file again when the machine is less loaded; cargo resumes from the crates already built');
    expect(built.error, `deep-show builds \`full\` for ${LINUX}`).toBe('');
    for (const threads of THREADS) {
      const linux = runLinux(scenario('/evidence', [DOC], calls(), { threads }), folder());
      expect(linux.arch, 'the second machine is x86_64, as the container reports it').toBe('x86_64');
      const row = judged(linux.replies, `${LINUX} with ${threads} threads`);
      expect(vertexHash(row), `${LINUX} with ${threads} threads builds ${MAC}'s hash: ${firstDifference(mac, row)}`).toBe(vertexHash(mac));
    }
    console.log(`${ID} vertex hash ${vertexHash(mac)} on ${MAC} and on ${LINUX} with 1, 4 and 8 threads`);
  }, 8 * TIMEOUT);
});
