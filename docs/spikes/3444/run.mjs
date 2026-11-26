#!/usr/bin/env node
// #3444's harness: one run a call, each a fresh process of a build that carries the probe (probe/README.md), under
// the machine's GPU lease, with the probe's rows kept beside its output.
//
//   node docs/spikes/3444/run.mjs cold     --bin <deep-gpu> --commit <hash> [--patch <file>] [--pixels WxH] [--kept yes] --out <file>
//   node docs/spikes/3444/run.mjs indirect --bin <deep-gpu> --commit <hash> --flag on|off --out <file>
//   node docs/spikes/3444/run.mjs state    --bin <deep-gpu> --commit <hash> --state one_window|four_windows --out <file>
//   node docs/spikes/3444/run.mjs state    --bin <deep-show> --commit <hash> --state export --out <file>
//   node docs/spikes/3444/run.mjs one-more --bin <spike-3444> --commit <hash> [--sets N] [--queries Q] [--drop K] --out <file>
//
// cold      The every-pass scene (#1903's, tests/acceptance/2189/fixtures/every-pass.json) opened by `envelope_opens`
//           in a fresh `deep-gpu run`: every pipeline the device made in the fresh open, with the time around its
//           call and, inside it, naga's override step, the Metal source writer and Metal's compile for each stage,
//           and Metal's making of the pipeline state as a `pipeline` stage. Then the same process draws frames
//           0, 30 and 59 of the scene (`view3d`, one frame a second) and keeps their pixel hashes. At 1280 x 800
//           unless --pixels says otherwise: main refuses the scene at 3456 x 2234, over its class's GPU memory.
//           The system keeps what Metal compiled, by its source, for every later process of the user
//           (com.apple.metal under the user's cache folder), so a second start compiles almost nothing. Without
//           --kept yes the run sets DEEP_3444_UNKEPT to a line of its own, which the probe appends to each Metal
//           source as a comment: nothing is kept for such a source, as on a Mac that never drew the scene.
// indirect  #484's forest of 100,000 trees (tests/acceptance/484/helpers.ts), 12 frames of warm-up and then its 61
//           frames, with WGPU_VALIDATION_INDIRECT_CALL set to 1 or 0, which the probe's wgpu-core reads as wgpu's
//           own `with_env` would; the flags' bits are the ones the probe read back from the instance. The geometry
//           pass's encode time is the time inside wgpu-core's encode of the render passes labelled
//           `scene3d.geometry`, and its GPU time the time on the GPU, by Metal's own clock, of those passes' command
//           buffers and of the "Pre Pass" buffer wgpu-core puts before each, where the validation's compute pass
//           runs; each is the median over the 61 frames of the frame's sum.
// state     `deep-gpu`'s `live` call with one window, or four windows each showing a 3D view, 120 frames; or a 3D
//           film's export by `deep-show`. `reads` are the device's own counters (wgpu's internal counters, wgpu-hal's
//           part), read by the probe as each submit began.
// one-more  The probe of its own (own-device/): 33 timestamp query sets asked of a device of its own.
//
// Every output has the commit the build was made from, the machine, the adapter, the load at its start and end, and
// `probe`: the file of the probe's rows its numbers were read from, kept beside it, with its sha256 (`written` is how
// many rows the run wrote in all). A run that can't draw on Metal says so and exits 1; nothing it couldn't
// read is written as a number.
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, loadavg, tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { fingerprint } from '../../../scripts/benchmark.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const SCENE = join(ROOT, 'tests', 'acceptance', '2189', 'fixtures', 'every-pass.json');
const GEOMETRY = 'scene3d.geometry';
const PRE_PASS = '(wgpu internal) Pre Pass';
const APP_DEVICE = 'deep-gpu';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length / 2) - 1)];
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const iso = (ms) => new Date(ms).toISOString();

function fail(message) {
  console.error(`run.mjs: ${message}`);
  process.exit(1);
}
const [mode, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i += 2) {
  if (!rest[i].startsWith('--') || rest[i + 1] === undefined) fail(`${rest[i]} needs a value`);
  args[rest[i].slice(2)] = rest[i + 1];
}
for (const need of ['bin', 'commit', 'out']) if (!args[need]) fail(`--${need} is required`);
if (!/^[0-9a-f]{40}$/.test(args.commit)) fail('--commit is the full hash of the commit the build was made from');
const bin = resolve(args.bin);
if (!existsSync(bin)) fail(`${args.bin} is not built`);
const out = resolve(args.out);
const probeFile = out.replace(/\.json$/, '.probe.jsonl');
mkdirSync(dirname(out), { recursive: true });
rmSync(probeFile, { force: true });
const work = mkdtempSync(join(tmpdir(), 'deep-3444-'));

/** The machine's GPU lease, the file every GPU job of this repository takes when no hub answers. */
const LEASE = join(homedir(), '.cache', 'deepbuild-gpu', 'lease');
async function lease() {
  mkdirSync(dirname(LEASE), { recursive: true });
  for (;;) {
    try {
      writeFileSync(LEASE, String(process.pid), { flag: 'wx' });
      return () => { if (existsSync(LEASE) && readFileSync(LEASE, 'utf8') === String(process.pid)) rmSync(LEASE); };
    } catch {
      const holder = Number(readFileSync(LEASE, 'utf8').trim());
      let alive = false;
      try { process.kill(holder, 0); alive = true; } catch { /* gone */ }
      if (!alive) rmSync(LEASE, { force: true });
      // The holder's exit is the event; a look every 250 ms is how the lease's other takers wait for it.
      else await new Promise((done) => setTimeout(done, 250));
    }
  }
}

/** The probe's rows from byte `from` to byte `to` of its file. */
function rows(from = 0, to = Infinity) {
  if (!existsSync(probeFile)) return [];
  const text = readFileSync(probeFile).subarray(from, Number.isFinite(to) ? to : undefined).toString('utf8');
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}
const probed = () => (existsSync(probeFile) ? statSync(probeFile).size : 0);

/** A `run` process of deep-gpu, answered one scenario line at a time: each answer with the probe file's size after it. */
function serve(env) {
  const child = spawn(bin, ['run'], { cwd: ROOT, env: { ...process.env, ...env, DEEP_3444_PROBE: probeFile }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (d) => { stderr = (stderr + d).slice(-4000); });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const exited = new Promise((done) => child.on('close', (code, signal) => done({ code, signal })));
  return {
    async ask(calls) {
      const from = probed();
      child.stdin.write(`${JSON.stringify({ out: work, calls })}\n`);
      const { value, done } = await lines.next();
      if (done) fail(`${args.bin} ended before it answered: ${JSON.stringify(await exited)} ${stderr.slice(-1500)}`);
      const answer = JSON.parse(value);
      if (answer.ok !== true) fail(`${args.bin} refused the scenario: ${value.slice(0, 1500)}`);
      for (const reply of answer.replies) if (reply.code !== undefined) fail(`${calls[0].call} was refused: ${JSON.stringify(reply).slice(0, 2500)}`);
      return { replies: answer.replies, from, to: probed() };
    },
    async end() {
      child.stdin.end();
      return exited;
    },
  };
}

const machine = () => {
  const m = fingerprint();
  if (process.platform !== 'darwin') fail('BLOCKED: the readings need a Mac\'s GPU');
  return m;
};
/**
 * What every output says of its run, and where it goes. Of the probe's rows only those `kept` picks stay beside the
 * output, the ones its numbers were read from: a run writes thousands more (every pass and command buffer of every frame).
 */
function keep(body, started, load, kept = () => true) {
  let probe = null;
  if (existsSync(probeFile)) {
    const all = rows();
    const stay = all.filter(kept);
    writeFileSync(probeFile, stay.map((r) => `${JSON.stringify(r)}\n`).join(''));
    probe = { path: relative(dirname(out), probeFile), sha256: sha256(readFileSync(probeFile)), rows: stay.length, written: all.length };
  }
  const whole = { commit: args.commit, binary: { name: basename(bin), sha256: sha256(readFileSync(bin)) }, machine: machine(), ...body, started: iso(started), ended: iso(Date.now()), load: { start: load, end: loadavg()[0] }, lease: 'the file ~/.cache/deepbuild-gpu/lease', probe };
  writeFileSync(out, `${JSON.stringify(whole, null, 1)}\n`);
  rmSync(work, { recursive: true, force: true });
  console.log(JSON.stringify({ out: relative(ROOT, out), sha256: sha256(readFileSync(out)) }));
}
const adapterOf = (reply) => ({ backend: reply.backend, name: reply.name });
const write = (name, doc) => { const path = join(work, `${name}.json`); writeFileSync(path, JSON.stringify(doc)); return path; };

/** The app's device as the probe saw it open: the flags its instance gave it. */
function appDevice(all) {
  const device = all.find((r) => r.ev === 'device' && r.label === APP_DEVICE);
  if (!device) fail(`BLOCKED: the build wrote no probe row for the device ${APP_DEVICE}: is it a build with the probe?`);
  return device;
}

// ---------------------------------------------------------------------------------------------------- cold

/** The pipelines a window of rows shows the device making, each with its stages. */
function pipelinesOf(window) {
  const made = window.filter((r) => r.ev === 'create' && r.kind !== 'shader_module');
  const named = new Map();
  const list = made.map((create) => {
    const inside = window.filter((r) => r.call === create.call && r !== create);
    const modules = new Map(inside.filter((r) => r.ev === 'stage_module').map((r) => [r.stage, r.module]));
    const stages = inside.filter((r) => r.ev === 'stage').map((r) => ({
      stage: r.stage, entry_point: r.entry, module: modules.get(r.stage) ?? null, module_entry_points: r.module_entry_points,
      override_ns: r.override_ns, source_ns: r.msl_ns, compile_ns: r.metal_ns,
      unkept: r.unkept, untouched: r.untouched, module_overrides: r.module_overrides, module_functions: r.module_functions, kept_functions: r.kept_functions, constants: r.constants, msl_bytes: r.msl_bytes,
    }));
    const whole = inside.find((r) => r.ev === 'hal_pipeline');
    if (whole) stages.push({ stage: 'pipeline', override_ns: 0, source_ns: 0, compile_ns: whole.state_ns });
    const entries = stages.filter((s) => s.entry_point).map((s) => s.entry_point).join('+');
    return { label: create.label, kind: create.kind, entries, around_ns: create.ns, hal_ns: whole?.hal_ns ?? null, stages };
  });
  // A name is one pipeline's: its label, then its entry points where the label is shared, then its place among those.
  for (const p of list) {
    const byLabel = list.filter((q) => q.label === p.label);
    let name = byLabel.length === 1 ? p.label : `${p.label} [${p.entries}]`;
    const same = byLabel.filter((q) => q.entries === p.entries);
    if (byLabel.length > 1 && same.length > 1) name = `${name} #${same.indexOf(p) + 1}`;
    if (named.has(name)) fail(`two pipelines came out named ${name}`);
    named.set(name, p);
    p.name = name;
  }
  return list.map(({ name, label, kind, around_ns, hal_ns, stages }) => ({ name, label, kind, around_ns, hal_ns, stages }));
}

async function cold() {
  const pixels = (args.pixels ?? '1280x800').split('x').map(Number);
  const patch = args.patch ? sha256(readFileSync(resolve(args.patch))) : null;
  const look = JSON.parse(readFileSync(join(ROOT, 'tests', 'acceptance', '1903', 'fixtures', 'look.json'), 'utf8'));
  const unkept = args.kept === 'yes' ? null : `spike 3444 ${randomBytes(12).toString('hex')}`;
  const release = await lease();
  const [started, load] = [Date.now(), loadavg()[0]];
  const gpu = serve(unkept ? { DEEP_3444_UNKEPT: unkept } : {});
  const opened = await gpu.ask([{ call: 'envelope_opens', look, writer: 'agent:alpha', doc: SCENE, pixels }]);
  const drawn = await gpu.ask([{ call: 'view3d', doc: SCENE, look, size: pixels, fps: 1, frames: 60, capture: [0, 30, 59] }]);
  const asked = await gpu.ask([{ call: 'adapter' }]);
  const end = await gpu.end();
  release();
  if (end.code !== 0) fail(`${args.bin} exited ${JSON.stringify(end)}`);
  const all = rows();
  const window = rows(opened.from, opened.to);
  const [fresh, again] = opened.replies[0].opens;
  if (fresh.open !== 'fresh') fail(`the first open is ${fresh.open}`);
  const pipelines = pipelinesOf(window);
  if (pipelines.length !== fresh.pipelines + again.pipelines) fail(`the probe saw ${pipelines.length} pipelines made in the two opens, and the device counted ${fresh.pipelines} and ${again.pipelines}`);
  const frames = drawn.replies[0].frames.filter((f) => [0, 30, 59].includes(f.frame)).map((f) => ({ frame: f.frame, pixel_hash: f.pixel_hash }));
  if (frames.length !== 3 || frames.some((f) => typeof f.pixel_hash !== 'string')) fail(`view3d hashed ${JSON.stringify(frames)}`);
  const device = appDevice(all);
  keep({
    adapter: adapterOf(asked.replies[0]), patch, scene: relative(ROOT, SCENE), pixels,
    // Whether the system could hold a compile of these Metal sources from an earlier run.
    metal_kept: unkept ? 'none: each source ends with a line no earlier run wrote' : 'whatever the system kept of earlier runs', unkept_line: unkept,
    open: fresh.open, first_settled_ms: fresh.ms, pipelines_made: fresh.pipelines,
    pipelines: pipelines.slice(0, fresh.pipelines),
    same_process: { ms: again.ms, pipelines_made: again.pipelines },
    // Beside the table: the shader modules the open made, and what wgpu made inside no call of ours (its own
    // validation pipelines, made as the device opened).
    modules: window.filter((r) => r.ev === 'create' && r.kind === 'shader_module').map((r) => ({ label: r.label, around_ns: r.ns })),
    wgpu_own: all.filter((r) => r.call === 0 && (r.ev === 'stage' || r.ev === 'hal_pipeline')).map((r) => (r.ev === 'stage'
      ? { stage: r.stage, entry_point: r.entry, override_ns: r.override_ns, source_ns: r.msl_ns, compile_ns: r.metal_ns }
      : { stage: 'pipeline', label: r.label, compile_ns: r.state_ns, hal_ns: r.hal_ns })),
    instance_flags: device.flags_bits, indirect_validation: device.indirect_validation,
    frames,
  }, started, load, (r) => ['create', 'stage', 'stage_module', 'hal_pipeline', 'instance', 'device', 'query_set'].includes(r.ev));
}

// ---------------------------------------------------------------------------------------------------- indirect

/** The command buffers committed from one submit row to the next window's first, by their place in commit order. */
function buffersOf(all, window, next) {
  const submits = window.filter((r) => r.ev === 'submit');
  if (!submits.length) return [];
  const from = submits[0].command_buffers_before;
  const to = next.find((r) => r.ev === 'submit')?.command_buffers_before ?? Infinity;
  return all.filter((r) => r.ev === 'command_buffer' && r.seq >= from && r.seq < to).sort((a, b) => a.seq - b.seq);
}

async function indirect() {
  if (!['on', 'off'].includes(args.flag)) fail('--flag is on or off');
  const { forest, view3dCall, FOREST_SIZE, ORBIT } = await import('../../../tests/acceptance/484/helpers.ts');
  const doc = write('forest', forest().doc);
  const release = await lease();
  const [started, load] = [Date.now(), loadavg()[0]];
  const gpu = serve({ WGPU_VALIDATION_INDIRECT_CALL: args.flag === 'on' ? '1' : '0' });
  await gpu.ask([view3dCall({ doc, size: FOREST_SIZE, fps: ORBIT.fps, frames: 12 })]);
  const timed = await gpu.ask([{ ...view3dCall({ doc, size: FOREST_SIZE, fps: ORBIT.fps, frames: ORBIT.frames }), timings: true, counts: true, capture: [] }]);
  const asked = await gpu.ask([{ call: 'adapter' }]);
  const end = await gpu.end();
  release();
  if (end.code !== 0) fail(`${args.bin} exited ${JSON.stringify(end)}`);
  const all = rows();
  const window = rows(timed.from, timed.to);
  const frames = timed.replies[0].frames;
  if (frames.length !== ORBIT.frames) fail(`view3d drew ${frames.length} frames`);
  const device = appDevice(all);
  // Each frame's rows: the frames are drawn one after the other, each with the same passes.
  const perFrame = (list, what) => {
    if (!list.length || list.length % frames.length !== 0) fail(`${list.length} ${what} over ${frames.length} frames: not the same count a frame`);
    const k = list.length / frames.length;
    return frames.map((_, i) => list.slice(i * k, (i + 1) * k));
  };
  const encodes = perFrame(window.filter((r) => r.ev === 'pass_encode' && r.label === GEOMETRY), `encodes of ${GEOMETRY}`);
  const buffers = buffersOf(all, window, rows(asked.from, asked.to));
  const gpuOf = (b) => (b.gpu_end_s - b.gpu_start_s) * 1e3;
  const passes = buffers.filter((b) => b.label === GEOMETRY);
  const pre = passes.map((b) => buffers.find((p) => p.seq === b.seq - 1 && p.label === PRE_PASS));
  const withPre = perFrame(passes.map((b, i) => gpuOf(b) + (pre[i] ? gpuOf(pre[i]) : 0)), `command buffers of ${GEOMETRY}`);
  const preOnly = perFrame(passes.map((_, i) => (pre[i] ? gpuOf(pre[i]) : 0)), 'pre-pass buffers');
  const read = new Set([...passes, ...pre.filter(Boolean)].map((b) => b.seq));
  const timer = frames.map((f) => f.passes_ms?.[GEOMETRY]).filter((x) => Number.isFinite(x));
  const draws = frames.map((f) => (f.indirect_draws ?? []).length);
  const validating = window.filter((r) => r.ev === 'pass_encode' && r.kind === 'compute' && /validation/i.test(r.label));
  keep({
    adapter: adapterOf(asked.replies[0]), flag: args.flag,
    instance_flags: device.flags_bits, indirect_validation: device.indirect_validation,
    instances: all.filter((r) => r.ev === 'instance').map((r) => r.flags_bits),
    forest: { instances: forest().doc.items.trees.params.ids.length, indirect_draws: Math.max(...draws), frames: frames.length, size: FOREST_SIZE },
    geometry: {
      encode_ms: median(encodes.map((f) => sum(f.map((r) => r.ns)) / 1e6)),
      gpu_ms: median(withPre.map(sum)),
      passes_a_frame: encodes[0].length,
      pre_pass_gpu_ms: median(preOnly.map(sum)),
      pass_timer_ms: timer.length ? median(timer) : null,
      encode_ms_by_frame: encodes.map((f) => Number((sum(f.map((r) => r.ns)) / 1e6).toFixed(4))),
      gpu_ms_by_frame: withPre.map((f) => Number(sum(f).toFixed(4))),
    },
    frame: {
      gpu_ms: median(perFrame(buffers.map(gpuOf), 'command buffers').map(sum)),
      command_buffers: buffers.length / frames.length,
      encode_ms: median(perFrame(window.filter((r) => r.ev === 'pass_encode'), 'pass encodes').map((f) => sum(f.map((r) => r.ns)) / 1e6)),
      wgpu_validation_encodes: validating.length,
    },
  }, started, load, (r) => ['instance', 'device'].includes(r.ev) || (r.ev === 'pass_encode' && r.label === GEOMETRY && r.t_ns >= window[0].t_ns)
    || (r.ev === 'command_buffer' && read.has(r.seq)));
}

// ---------------------------------------------------------------------------------------------------- state

const STATE_ROWS = ['instance', 'device', 'query_set'];
/** The device's own counters as each submit of the window read them: the first, the last, and each where the sets change. */
function readsOf(window, label) {
  const submits = window.filter((r) => r.ev === 'submit' && r.device === label);
  const kept = submits.filter((r, i) => i === 0 || i === submits.length - 1 || r.query_sets !== submits[i - 1].query_sets);
  return {
    taken: submits.length,
    rows: new Set(kept.map((r) => r.t_ns)),
    reads: kept.map((r) => ({ at: iso(r.unix_ms), hal: { buffers: r.buffers, textures: r.textures, query_sets: r.query_sets, render_pipelines: r.render_pipelines, compute_pipelines: r.compute_pipelines, shader_modules: r.shader_modules } })),
  };
}
/** The timestamp query sets alive when the count was largest, by their labels. */
function setsOf(window) {
  const alive = [];
  let most = [];
  for (const r of window.filter((x) => x.ev === 'query_set')) {
    if (r.op === 'create') alive.push(`${r.label || '(no label)'} x${r.queries}`);
    if (alive.length > most.length) most = [...alive];
    if (r.op === 'destroy' && r.ty === 'timestamp') alive.pop();
  }
  return most;
}

async function state() {
  const name = args.state;
  const [started, load] = [Date.now(), loadavg()[0]];
  if (name === 'export') {
    // A 3D film, 160 x 90 at 24 frames a second for 2 s: a camera, a ground and a turning box (after #501's scope film).
    const box = (id, pos, role, order) => ({ id, kind: 'mark.box@1', name: `Box ${id}`, order, params: { size: [1, 1, 1], paint: { fill: { role } } }, at: { pos } });
    const film = {
      format: 1, id: 'film-3444', profile: 'film', title: 'A 3D film', description: 'The film #3444\'s export state exports.', size: [160, 90],
      items: Object.fromEntries([
        { id: 'cam', kind: 'camera@1', name: 'Camera cam', order: 'a0', params: { projection: 'perspective', position: [0, 1.5, 6], target: [0, 0, 0], fov: 40 } },
        box('left', [-1.6, 0, 0], 'accent', 'a1'), box('core', [0, 0, 0], 'ink', 'a2'),
      ].map((i) => [i.id, i])),
      camera: 'cam', transport: { span: '2s', frame_rate: [24, 1] }, requires: { modules: { scene3d: '^1' } },
      channels: { turn: { target: 'items/core/at/rot/1', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '2s', value: 180, interp: 'linear' } } } },
    };
    const doc = '01JB3444D00000000000000001';
    const scenario = {
      evidence: join(work, 'evidence'), sessions: {}, processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3000 }],
      panels: { main: { rect: [0, 0, 1280, 720] } }, docs: { [doc]: { panel: 'main' } },
      calls: [{ call: 'deep show', peer: { pid: 3002, start: 3000 }, doc, document: film, include: ['issues'] }, { call: 'export', doc, out: join(work, 'film.mp4'), video: { codec: 'h264' } }],
    };
    mkdirSync(scenario.evidence, { recursive: true });
    // deep-show takes the GPU lease itself, the file with no hub; its HOME is this run's own, so it finds no hub.
    const ran = spawnSync(bin, ['run'], { cwd: ROOT, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, DEEP_3444_PROBE: probeFile } });
    const answer = JSON.parse(ran.stdout.split('\n').find((l) => l.trim()) ?? 'null');
    const exported = answer?.replies?.[1] ?? answer?.[1] ?? answer;
    if (ran.status !== 0 || !existsSync(join(work, 'film.mp4'))) fail(`deep-show's export left no film: exit ${ran.status} ${JSON.stringify(answer).slice(0, 2500)} ${ran.stderr.slice(-1500)}`);
    const all = rows();
    const device = appDevice(all);
    const { taken, reads, rows: read } = readsOf(all, APP_DEVICE);
    keep({
      adapter: { backend: device.backend.toLowerCase(), name: device.adapter }, state: name, device: { label: device.label },
      film: { frames: 48, size: [160, 90], bytes: statSync(join(work, 'film.mp4')).size, lease: exported?.export?.lease ?? exported?.lease ?? null },
      reads_taken: taken, reads, sets_at_most: setsOf(all),
    }, started, load, (r) => STATE_ROWS.includes(r.ev) || (r.ev === 'submit' && read.has(r.t_ns)));
    return;
  }
  const windows = { one_window: 1, four_windows: 4 }[name];
  if (!windows) fail('--state is one_window, four_windows or export');
  // #777's look and its work-product scene: a 3D view whose box slides, so every frame draws.
  const look = JSON.parse(readFileSync(join(ROOT, 'tests', 'acceptance', '777', 'fixtures', 'look.json'), 'utf8'));
  const scene = (title) => {
    const items = { cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'perspective', target: [0, 0, 0], orbit: { azimuth: 30, elevation: 35, distance: 14 }, fov: 40 } } };
    for (let i = 0; i < 4; i++) items[`box-${i}`] = { id: `box-${i}`, kind: 'mark.box@1', name: `Box ${i}`, order: `b${String(i).padStart(3, '0')}`, params: { size: [1, 1, 1], paint: { fill: { role: 'accent' } } }, at: { pos: [i * 2.5 - 3.75, 0.5, -2.5] } };
    return {
      format: 1, profile: 'scene', title, description: `${title}: a 3D view of #3444's ${name} state.`, size: [640, 400], camera: 'cam',
      requires: { modules: { scene3d: '^1' } }, budget: { class: 'work_product' }, transport: { span: '60s' }, items,
      channels: { slide: { target: 'items/box-0/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: -3.75, interp: 'linear' }, k1: { t: '60s', value: 3.75, interp: 'linear' } } } },
    };
  };
  const ids = Array.from({ length: windows }, (_, i) => i + 1);
  const call = {
    call: 'live', look, frames: 120, fps: 60, report: ['meter'],
    windows: ids.map((i) => ({ window: `w-${i}`, display: `6F1C2B9E-3D4A-4E7B-9A21-0C5D8E7F6A1${i}` })),
    sessions: ids.map((i) => ({ session: `s-${i}`, writer: `agent:w${i}`, window: `w-${i}`, doc: write(`view-${i}`, scene(`View ${i}`)) })),
  };
  const release = await lease();
  const gpu = serve({});
  const lived = await gpu.ask([call]);
  const asked = await gpu.ask([{ call: 'adapter' }]);
  const end = await gpu.end();
  release();
  if (end.code !== 0) fail(`${args.bin} exited ${JSON.stringify(end)}`);
  const all = rows();
  const device = appDevice(all);
  const window = rows(lived.from, lived.to);
  const { taken, reads, rows: read } = readsOf(window, APP_DEVICE);
  const views = new Set((lived.replies[0].frames ?? []).flatMap((f) => (f.views ?? []).filter((v) => v.drawn !== false).map((v) => v.session)));
  keep({
    adapter: adapterOf(asked.replies[0]), state: name, device: { label: device.label }, windows, views_3d: views.size || null,
    frames: 120, reads_taken: taken, reads, sets_at_most: setsOf(all),
    sets_before_the_windows: readsOf(rows(0, lived.from), APP_DEVICE).reads.at(-1)?.hal.query_sets ?? 0,
  }, started, load, (r) => STATE_ROWS.includes(r.ev) || (r.ev === 'submit' && read.has(r.t_ns)));
}

// ---------------------------------------------------------------------------------------------------- one more

async function oneMore() {
  const release = await lease();
  const [started, load] = [Date.now(), loadavg()[0]];
  const flags = ['--sets', args.sets ?? '33', '--queries', args.queries ?? '2', ...(args.drop ? ['--drop', args.drop] : [])];
  const ran = spawnSync(bin, flags, { encoding: 'utf8', maxBuffer: 1 << 26 });
  release();
  let report;
  try { report = JSON.parse(ran.stdout); } catch { fail(`${args.bin} printed no report: exit ${ran.status} ${ran.stderr.slice(-1500)}`); }
  if (report.status !== 'RAN') fail(`BLOCKED: ${JSON.stringify(report)}`);
  const { adapter, device, attempts, outcome, ...more } = report;
  keep({ adapter, device, command: `spike-3444 ${flags.join(' ')}`, attempts, outcome, ...more }, started, load);
}

await ({ cold, indirect, state, 'one-more': oneMore }[mode] ?? (() => fail(`no mode ${mode}: cold, indirect, state or one-more`)))();
