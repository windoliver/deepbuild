// `deep doctor`'s canvas items (#140; canvas primitives: Seam and backend): the GPU adapter with its tier's feature
// table, as the GPU seam's macOS backend opened it; a fixture rendered headless with Vello CPU and compared with its
// golden; and the canvas verdict they make. The verdict is healthy only once the fixture rendered within its golden,
// unhealthy when the render failed or missed it, and unverified, never healthy, when the render didn't run. They run
// the checkout's builds of the canvas binaries, as the hub's canvas side does. DEEP_DOCTOR_CANVAS_FAULT is a fault
// fixture only tests set: `render_fails` sends the render where it can't write, as on a Mac whose headless rendering
// is broken, and `render_skipped` skips it.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Item } from './doctor.js';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURE = fileURLToPath(new URL('../fixtures/canvas-doctor.json', import.meta.url));
const AGENT = 'deepbuild';

/** The checkout's build of a canvas binary, the newer of release and debug. */
function built(bin: string): string | undefined {
  const found = ['release', 'debug'].map((p) => join(REPO, 'target', p, bin)).filter((p) => existsSync(p));
  return found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

/** One JSON line in, the binary's first answer line out, with a 60 s cap. */
function answer(bin: string, args: string[], line: unknown): Promise<{ answer: Obj | undefined; exit: number | null; err: string }> {
  return new Promise((done) => {
    const child = execFile(bin, args, { timeout: 60_000, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (error, out, err) => {
      let parsed: Obj | undefined;
      try { parsed = JSON.parse(String(out).split('\n')[0] ?? '') as Obj; } catch { parsed = undefined; }
      done({ answer: parsed, exit: error ? (typeof error.code === 'number' ? error.code : null) : 0, err: String(err) });
    });
    child.stdin?.end(`${JSON.stringify(line)}\n`);
  });
}

const label = (feature: string): string => feature.replaceAll('_', ' ');

/** canvas.gpu: the adapter, its tier and each feature of the tier's table, granted or absent. */
async function gpuItem(): Promise<Item> {
  const item = (code: string, level: Item['level'], evidence: string, fix: string): Item => ({ item: 'canvas.gpu', agent: AGENT, code, level, evidence, fix });
  const bin = built('deep-gpu');
  if (!bin) return item('binary_missing', 'fail', `no deep-gpu is built under ${join(REPO, 'target')}`, 'Run `cargo build --locked --bin deep-gpu`, then `deep doctor` again.');
  const out = mkdtempSync(join(tmpdir(), 'deep-doctor-gpu-'));
  try {
    const r = await answer(bin, ['run'], { out, calls: [{ call: 'adapter' }] });
    if (r.answer?.code === 'missing_feature') {
      return item('gpu_unsupported', 'fail', `the GPU seam refused ${String(r.answer.adapter)}: it lacks ${JSON.stringify(r.answer.missing)}, which the tier's table requires`, 'Run the canvas on a Mac whose GPU grants those features; run `deep-gpu run` with {"call": "adapter"} to read the table.');
    }
    const reply = Array.isArray(r.answer?.replies) ? r.answer.replies[0] : undefined;
    if (!isObj(reply) || !Array.isArray(reply.table) || !isObj(reply.adapter)) {
      return item('render_failed', 'fail', `deep-gpu answered no adapter (exit ${r.exit}): ${JSON.stringify(r.answer ?? r.err).slice(0, 400)}`, 'Run `cargo build --locked --bin deep-gpu`, then `deep doctor` again.');
    }
    const granted = new Set(Array.isArray(reply.granted) ? reply.granted.map(String) : []);
    const rows = reply.table.filter(isObj).map((r) => `${label(String(r.feature))} ${granted.has(String(r.feature)) ? 'granted' : 'absent'}${r.required ? ' (required)' : ''}`);
    const seam = isObj(reply.seam) ? `${String(reply.seam.name)} ${String(reply.seam.version)}` : 'the GPU seam';
    const extra = [
      `ray queries ${reply.ray_query === true ? 'reported' : 'absent'} (no path of this tier uses them before R6)`,
      `MSAA sample counts ${Array.isArray(reply.msaa) ? reply.msaa.join(', ') : 'unread'}`,
    ];
    return item('healthy', 'ok', `${String(reply.adapter.name)} through ${seam}, tier ${String(reply.tier)}: ${[...rows, ...extra].join('; ')}`, 'Nothing to do.');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

/** canvas.headless: the fixture rendered headless with Vello CPU, its PNG against its golden. */
async function headlessItem(fault: string | undefined): Promise<Item> {
  const item = (code: string, level: Item['level'], evidence: string, fix: string): Item => ({ item: 'canvas.headless', agent: AGENT, code, level, evidence, fix });
  if (fault === 'render_skipped') return item('not_checked', 'skip', 'unverified: the headless render was skipped, so nothing says the canvas draws', 'Run `deep doctor` again without skipping the render.');
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { doc: Obj; look: Obj; golden: { png_sha256: string } };
  const bin = built('deep-canvas-render');
  if (!bin) return item('render_failed', 'fail', `no deep-canvas-render is built under ${join(REPO, 'target')}, so nothing can render headless`, 'Run `cargo build --locked --bin deep-canvas-render`, then `deep doctor` again.');
  const dir = mkdtempSync(join(tmpdir(), 'deep-doctor-canvas-'));
  try {
    const png = fault === 'render_fails' ? join(dir, 'missing', 'fixture.png') : join(dir, 'fixture.png');
    const r = await answer(bin, ['raster'], { out: png, doc: fixture.doc, look: fixture.look, t: 0 });
    const rebuild = 'Run `cargo build --locked --bin deep-canvas-render`, then `deep doctor` again; if the render still fails, attach `deep debug bundle` to a bug report.';
    if (r.answer?.ok !== true || !existsSync(png)) return item('render_failed', 'fail', `the fixture's headless render failed (exit ${r.exit}): ${JSON.stringify(r.answer ?? r.err).slice(0, 400)}`, rebuild);
    const sha = createHash('sha256').update(readFileSync(png)).digest('hex');
    if (sha !== fixture.golden.png_sha256) return item('render_failed', 'fail', `the fixture rendered headless to ${sha}, not its golden ${fixture.golden.png_sha256}`, rebuild);
    return item('healthy', 'ok', `the fixture rendered headless with Vello CPU within its golden (${sha})`, 'Nothing to do.');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Every canvas item, the verdict last. */
export async function canvasItems(env: NodeJS.ProcessEnv): Promise<Item[]> {
  const [gpu, headless] = await Promise.all([gpuItem(), headlessItem(env.DEEP_DOCTOR_CANVAS_FAULT)]);
  const failed = [gpu, headless].filter((i) => i.level === 'fail');
  const verdict: Item = failed.length
    ? { item: 'canvas.verdict', agent: AGENT, code: 'render_failed', level: 'fail', evidence: `the canvas is unhealthy: ${failed.map((i) => `${i.item} failed`).join(', ')}`, fix: failed[0]!.fix }
    : headless.level === 'ok'
      ? { item: 'canvas.verdict', agent: AGENT, code: 'healthy', level: 'ok', evidence: 'the canvas is healthy: its fixture rendered headless within its golden', fix: 'Nothing to do.' }
      : { item: 'canvas.verdict', agent: AGENT, code: 'not_checked', level: 'skip', evidence: 'unverified: the headless render didn\'t run, so the canvas is never called healthy', fix: 'Run `deep doctor` again with the render.' };
  return [gpu, headless, verdict];
}
