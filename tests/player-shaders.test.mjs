import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { SHADER_RECORD, shaderRecord } from '../scripts/player-shaders.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const script = join(repo, 'scripts/player-shaders.mjs');
const DIST = 'crates/deep-player/web/dist';
const LIT = 'fn local_lit(l: Local, world: vec3<f32>) -> f32 {\n  return 1.0;\n}\n';
const UNLINKED = 'fn diag() -> f32 {\n  return 0.0;\n}\n';

function builtPlayer(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3638-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, bytes) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), bytes); };
  write('crates/deep-scene3d-render/src/scene3d.wgsl', LIT);
  write('crates/deep-scene3d-render/src/diag.wgsl', UNLINKED);
  write(`${DIST}/full/player_bg.wasm`, Buffer.concat([Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]), Buffer.from(LIT), Buffer.from([0xff, 0x00])]));
  write(`${DIST}/figure/player_bg.wasm`, Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
  write(`${DIST}/${SHADER_RECORD}`, `${JSON.stringify(shaderRecord(root, join(root, DIST)), null, 2)}\n`);
  return { root, write };
}
const check = (root) => spawnSync(process.execPath, [script, '--root', root], { encoding: 'utf8' });

test('a freshly built player records the shaders each set holds, and the check passes on it (#3638)', (t) => {
  const { root } = builtPlayer(t);
  assert.deepEqual(JSON.parse(readFileSync(join(root, DIST, SHADER_RECORD), 'utf8')), { figure: [], full: ['crates/deep-scene3d-render/src/scene3d.wgsl'] });
  const ran = check(root);
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  assert.match(ran.stdout, /^PASS player-shaders: /m);
});

test('a shader changed without the set being built again fails, naming the set and the shader', (t) => {
  const { root, write } = builtPlayer(t);
  write('crates/deep-scene3d-render/src/scene3d.wgsl', LIT.replace('world: vec3<f32>', 'world: vec3<f32>, bias: f32'));
  const ran = check(root);
  assert.equal(ran.status, 1, ran.stdout + ran.stderr);
  assert.match(ran.stdout, /^FAIL player-shaders: crates\/deep-player\/web\/dist\/full\/player_bg\.wasm was built with crates\/deep-scene3d-render\/src\/scene3d\.wgsl as an older text than the checkout's$/m);
  assert.match(ran.stdout, /^ {2}Fix: .*node scripts\/player-wasm\.mjs/m);
  assert.doesNotMatch(ran.stdout, /figure|diag\.wgsl/);
});

test('a shader a set holds that the checkout no longer has fails too, and one no set holds may change', (t) => {
  const { root, write } = builtPlayer(t);
  write('crates/deep-scene3d-render/src/diag.wgsl', `${UNLINKED}// changed\n`);
  assert.equal(check(root).status, 0);
  rmSync(join(root, 'crates/deep-scene3d-render/src/scene3d.wgsl'));
  const ran = check(root);
  assert.equal(ran.status, 1, ran.stdout + ran.stderr);
  assert.match(ran.stdout, /^FAIL player-shaders: .*full\/player_bg\.wasm was built with crates\/deep-scene3d-render\/src\/scene3d\.wgsl which the checkout no longer has$/m);
});

test('a player with no shader record is BLOCKED, never passed', (t) => {
  const { root } = builtPlayer(t);
  rmSync(join(root, DIST, SHADER_RECORD));
  const ran = check(root);
  assert.equal(ran.status, 2, ran.stdout + ran.stderr);
  assert.match(ran.stdout, /^BLOCKED player-shaders: /m);
});

test('the committed web player holds its shaders as this checkout has them, and its record is what its bytes hold', () => {
  const ran = check(repo);
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(repo, DIST, SHADER_RECORD), 'utf8')), shaderRecord(repo, join(repo, DIST)));
});
