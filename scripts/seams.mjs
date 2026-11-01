// Every platform seam's conformance suite in the local preflight (issue #140; canvas primitives: Seam and backend,
// `conformance: {seam → suite}`): the lane `seams` and the perf task `seam-suites`. Each seam's suite runs on this
// build's backend; a suite that needs what this run can't give (a second GPU family, the app's shown window, a
// person at the system picker, a backend R2 doesn't ship) is BLOCKED with its reason, never PASS. It exits 1 when a
// suite FAILs, and its last line is `{"conformance": {seam: {suite, status, backend, reason?}}}`.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const bin = (name) => join(root, 'target', 'debug', name);
const out = mkdtempSync(join(tmpdir(), 'deep-seams-'));

/** One JSON line in, the binary's JSON answer lines out. */
function run(name, args, line) {
  const r = spawnSync(bin(name), args, { cwd: root, input: `${JSON.stringify(line)}\n`, encoding: 'utf8', maxBuffer: 2 ** 28 });
  return r.stdout.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
}
const blocked = (suite, reason, backend = null) => ({ suite, status: 'BLOCKED', backend, reason });

const conformance = {};
try {
  const build = spawnSync('cargo', ['build', '--locked', '--bin', 'deep-gpu', '--bin', 'deep-show', '--bin', 'deep-canvas-render'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  if (build.status !== 0) throw Error('the canvas binaries did not build');

  // gpu: the exact-class fixtures and their comparison across GPU families; one GPU family is BLOCKED by design.
  const [gpu] = run('deep-gpu', ['run'], { out, calls: [{ call: 'seam_suite', seam: 'gpu' }] });
  const g = gpu?.replies?.[0];
  conformance.gpu = { suite: 'gpu.conformance', status: g?.result ?? 'FAIL', backend: g?.backend ?? null, ...(g?.asks?.length ? { reason: g.asks[0].ask } : {}) };

  // fonts: the fixture's glyph runs, the app's GPUI frame against the headless raster, under two process locales.
  const fixture = JSON.parse(readFileSync(join(root, 'packages', 'hub', 'fixtures', 'canvas-doctor.json'), 'utf8'));
  const line = (n) => ({ out: join(out, `${n}.png`), doc: fixture.doc, look: fixture.look, t: 0 });
  const raster = (lang) => spawnSync(bin('deep-canvas-render'), ['raster'], { input: `${JSON.stringify(line(`raster-${lang}`))}\n`, encoding: 'utf8', env: { ...process.env, LANG: lang, LC_ALL: lang } });
  const [headless] = raster('en_US.UTF-8').stdout.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
  const [german] = raster('de_DE.UTF-8').stdout.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
  const [app] = run('deep-canvas-render', ['render'], line('render'));
  const same = (a, b) => JSON.stringify(a?.texts) === JSON.stringify(b?.texts) && a?.texts && Object.keys(a.texts).length > 0;
  conformance.fonts = { suite: 'fonts.glyph-runs', status: same(headless, app) && same(headless, german) ? 'PASS' : 'FAIL', backend: headless?.backends?.fonts ?? null };

  // headless: the fixture rendered by Vello CPU against its golden.
  const png = readFileSync(join(out, 'raster-en_US.UTF-8.png'));
  const sha = createHash('sha256').update(png).digest('hex');
  conformance.headless = { suite: 'headless.golden', status: sha === fixture.golden.png_sha256 ? 'PASS' : 'FAIL', backend: headless?.backends?.headless ?? null };
  conformance.cpu = blocked('cpu.exact-records', 'the exact-class records of a second architecture are needed to compare with this one', headless?.backends?.cpu ?? null);

  // network: 10,000 messages through the test relay's delays, drops, duplicates and reorders, on the macOS backend (#309).
  const [net] = run('deep-show', ['run'], { evidence: out, calls: [{ call: 'seam_suite', seam: 'network', backend: 'network.macos', messages: 10000, seed: 1 }] });
  const n = net?.replies?.[0];
  conformance.network = { suite: n?.suite ?? 'network.conformance@1', status: n?.status ?? 'FAIL', backend: n?.backend ?? null };

  // input: the window and input backends' capability table, every absent capability's consumers naming their behavior.
  const [caps] = run('deep-show', ['run'], { evidence: out, calls: [{ call: 'window_caps' }] });
  const c = caps?.replies?.[0];
  const named = c?.caps && Object.values(c.caps).every((cap) => cap.declared || cap.consumers.every((x) => x.when_absent));
  conformance.input = { suite: 'input.capabilities', status: named ? 'PASS' : 'FAIL', backend: c?.backend ?? null };

  // Suites that need the app's shown window, a person, or a backend R2 doesn't ship.
  const window = 'needs the app\'s shown window: tests/acceptance/140 runs it live with DEEP_140_LIVE=1';
  conformance.surface = blocked('surface.color-check', `${window} (deep-app --color-check)`);
  conformance.color = blocked('color.swatches', `${window} (deep-app --color-check)`);
  conformance.display = blocked('display.presentation', `${window} (deep-show live, paced at 60 and 120 Hz)`);
  conformance.accessibility = blocked('accessibility.tree', `${window} (deep-show live with tree), and a person listening to VoiceOver`);
  conformance.capture = blocked('capture.picker', 'needs a person to answer the system capture picker (deep-app --capture-seam)');
  conformance.codecs = blocked('codecs.decode', 'no codecs backend ships in R2, so documents that need one are refused module_missing');
  conformance.audio = blocked('audio.clock', 'no audio backend ships in R2, so documents that need one are refused module_missing');
} catch (error) {
  console.error(`seams: ${error.message}`);
} finally {
  rmSync(out, { recursive: true, force: true });
}

const failed = Object.entries(conformance).filter(([, s]) => s.status === 'FAIL');
for (const [seam, s] of Object.entries(conformance)) console.log(`${s.status} ${seam}: ${s.suite}${s.reason ? ` (${s.reason})` : ''}`);
console.log(JSON.stringify({ conformance }));
process.exit(failed.length || Object.keys(conformance).length < 13 ? 1 : 0);
