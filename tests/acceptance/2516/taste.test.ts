// AC7 "Shown to you: #418's room and the castle with ao on, as main draws them and after the change, taken by the check run
// from the renderer's own output, are attached to the PR and shown to you in the session. Whether the corners look right
// at the default radius and strength is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and
// no criterion above reads a picture to judge it"
//
// One run draws four pictures with the look's ao at every default (radius 0.5, strength 1, 8 samples, half resolution,
// multi_bounce and specular on): #418's room (`room(…, 'both')` from tests/acceptance/418/helpers.ts: the floor, the wall
// and the card under the sun and the sky, 640 × 480, #418's look) and the castle (packs/examples/castle.json with its pack
// and castle.look.json plus `ao`, at its own 1280 × 800), each by main and by this checkout.
//   - "As main draws them": a `deep-gpu` built from the base commit's own tree (`git archive`, into a temporary folder,
//     its own CARGO_TARGET_DIR under target/), drawing main's castle and pack from that tree. Never a plant: a plant is
//     this checkout's program.
//   - "After the change": this checkout's `deep-gpu`.
// Each final target, the renderer's PNG byte for byte, is copied to docs/evidence/2516/ and its SHA-256 printed. Every
// frame drawn with ao on changes (the issue's scope), so each "after" picture must differ from main's. It then reads
// tests/acceptance/2516/TASTE.json: none, or one made on other pictures, reads INCONCLUSIVE; `looks_wrong` fails;
// `looks_right` on exactly these pictures passes. No other test reads these pictures or the call.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AO_DEFAULTS, BASE_SHA, REPO, draw, frameAt, git, inconclusive, look, namedFile, requireGpu, room, sha256, useGpuBin, useOut, writeJson,
  type JsonObject, type JsonValue,
} from './helpers.ts';

const after = useGpuBin();
const out = useOut();
const SHOTS = join(REPO, 'docs', 'evidence', '2516');
const TASTE = join(REPO, 'tests', 'acceptance', '2516', 'TASTE.json');
const NAMES = ['room-main.png', 'room-after.png', 'castle-main.png', 'castle-after.png'] as const;
const ROOM_ROLES: Record<string, [number, number, number]> = { floor: [150, 150, 150], wall: [176, 176, 176], card: [210, 200, 190] };
const MAIN_TARGET = join(REPO, 'target', 'acceptance-2516-main');

/** `deep-gpu` built from the base commit's own tree; returns the binary and the tree. */
function buildMain(into: string): { bin: string; tree: string } {
  const tree = join(into, 'main');
  mkdirSync(tree);
  const archive = spawnSync('git', ['archive', '--format=tar', BASE_SHA], { cwd: REPO, maxBuffer: 2 * 1024 * 1024 * 1024 });
  expect(archive.status, `git archive ${BASE_SHA}: ${archive.stderr?.toString().slice(0, 2000)}`).toBe(0);
  const untar = spawnSync('tar', ['-x', '-C', tree], { input: archive.stdout, maxBuffer: 64 * 1024 * 1024 });
  expect(untar.status, `tar -x of main's tree: ${untar.stderr?.toString().slice(0, 2000)}`).toBe(0);
  const build = spawnSync('cargo', ['build', '--locked', '--bin', 'deep-gpu'], {
    cwd: tree, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CARGO_TARGET_DIR: MAIN_TARGET, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' },
  });
  expect(build.status, `main's deep-gpu builds from ${BASE_SHA.slice(0, 8)}: ${(build.stderr ?? '').split('\n').filter((l) => !/Compiling|Finished|Downloaded|Downloading|Blocking/.test(l)).join('\n').slice(0, 4000)}`).toBe(0);
  const bin = join(into, 'deep-gpu-main');
  copyFileSync(join(MAIN_TARGET, 'debug', 'deep-gpu'), bin);
  return { bin, tree };
}

function pictures(bin: string, dir: string, tree: string, who: string): { room: Buffer; castle: Buffer } {
  const roomDoc = writeJson(dir, `room-${who}.json`, room(`room-2516-${who}`, 'both'));
  const castle = JSON.parse(readFileSync(join(tree, 'packs', 'examples', 'castle.json'), 'utf8')) as JsonObject;
  const castleLook = JSON.parse(readFileSync(join(tree, 'packs', 'examples', 'castle.look.json'), 'utf8')) as JsonObject;
  const [r, c] = draw(bin, dir, [
    { call: 'view3d', doc: roomDoc, look: look('ao-2516-room', ROOM_ROLES, { ao: AO_DEFAULTS }), size: [640, 480], frames: 1, targets: ['final'], capture: [0] },
    { call: 'view3d', doc: join(tree, 'packs', 'examples', 'castle.json'), look: { ...castleLook, ao: AO_DEFAULTS }, size: castle['size'] as JsonValue, packs: [join(tree, 'packs', 'composites-1.0.0')], frames: 1, targets: ['final'], capture: [0] },
  ]);
  const png = (reply: JsonObject, what: string): Buffer => namedFile(dir, frameAt(reply, 0, what).raw['final'] as string, 'png', what);
  return { room: png(r!, `${who}: the room`), castle: png(c!, `${who}: the castle`) };
}

describe('AC7 the room and the castle with ao on, as main draws them and after, and the one taste call on them', () => {
  it('AC7 the run writes #418\'s room and the castle as main draws them and after the change, from the renderer\'s own output, each after-picture differs from main\'s, and the recorded taste call on exactly those says the corners look right', () => {
    requireGpu();
    const dir = out();
    const scratch = mkdtempSync(join(tmpdir(), 'deep-2516-main-'));
    let shots: Record<string, Buffer>;
    try {
      const main = buildMain(scratch);
      const m = pictures(main.bin, dir, main.tree, 'main');
      const a = pictures(after.bin(), dir, REPO, 'after');
      shots = { 'room-main.png': m.room, 'room-after.png': a.room, 'castle-main.png': m.castle, 'castle-after.png': a.castle };
    } finally { rmSync(scratch, { recursive: true, force: true }); }
    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    for (const n of NAMES) { writeFileSync(join(SHOTS, n), shots[n]!); hashes[n] = sha256(shots[n]!); }
    const listed = NAMES.map((n) => `  docs/evidence/2516/${n}  ${hashes[n]}`).join('\n');
    console.log(`AC7: pictures written from this run's pixels (main = ${BASE_SHA.slice(0, 8)}, after = ${git(['rev-parse', '--short', 'HEAD']).stdout.trim()}):\n${listed}`);
    expect(hashes['room-after.png'], 'the room with ao on draws differently after the change than on main').not.toBe(hashes['room-main.png']);
    expect(hashes['castle-after.png'], 'the castle with ao on draws differently after the change than on main').not.toBe(hashes['castle-main.png']);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: attach these to the PR, show them to the owner in the session\n${listed}\nand record the answer in tests/acceptance/2516/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(2516);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('AC7');
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && !Number.isNaN(Date.parse(c['when'])) && /^\d{4}-\d\d-\d\dT/.test(c['when']), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const recorded = c['screenshots'] as Record<string, JsonValue> | undefined;
    expect(typeof recorded === 'object' && recorded !== null && !Array.isArray(recorded), 'TASTE.json: screenshots, by name').toBe(true);
    expect(Object.keys(recorded!).sort(), 'TASTE.json names the four pictures').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded![n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded![n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says the corners don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`AC7: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: the corners look right at the default radius and strength`);
  }, 7_200_000);
});
