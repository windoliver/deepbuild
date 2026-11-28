import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTrace } from './trace.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const BIN = join('spikes', '3031', 'target', 'release', 'spike-3031');
const CLASSES = ['core_view', 'data_view', 'figure', 'work_product', 'showpiece', 'export'];
const EVERY_PASS = 'every_pass';
const NAMES = [...CLASSES, EVERY_PASS];
const FIXTURES = {
  ...Object.fromEntries(CLASSES.map((c) => [c, { doc: `benchmarks/canvas/${c}.json`, look: 'tests/acceptance/379/fixtures/look.json' }])),
  [EVERY_PASS]: { doc: 'docs/spikes/3031/fixtures/every-pass-plus.json', look: 'docs/spikes/3031/fixtures/every-pass-plus.look.json' },
};
const FRAMES = 300;
const FPS = 5;
const FLICKS = 705_600_000;
const SHARE_BYTES = 32_000_000;
const OVERDRAW_PAST = 1.5;

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const lines = (path) => readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const out = (name, kind) => `out/${name}.${kind}.json`;
const grouped = (n) => n.toLocaleString('en-US');
const mb = (n) => (n / 1e6).toFixed(1);

function harness(mode, f, dir) {
  const args = [mode, '--doc', f.doc, '--look', f.look, '--frames', String(FRAMES), '--fps', String(FPS), '--out', dir];
  const run = spawnSync(BIN, args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
  let summary;
  try { summary = JSON.parse(run.stdout); } catch { throw Error(`spike-3031 ${mode} printed no summary (exit ${run.status}): ${run.stderr.slice(-2000)}`); }
  if (run.status !== 0 || summary.status !== 'RAN') throw Error(summary.reason ?? `spike-3031 ${mode} exited ${run.status}`);
  if (summary.raised.length) throw Error(`the device raised: ${summary.raised.join('; ')}`);
  return summary;
}

function head(name, f, s) {
  const pinned = (path) => ({ path, sha256: sha256(readFileSync(join(root, path))) });
  const main = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const { model, chip, os_version, os_build, power, load, date } = s.host;
  return {
    fixture: name, date, main, scene: pinned(f.doc), look: pinned(f.look), size: s.size,
    command: `${BIN} ${s.mode} --doc ${f.doc} --look ${f.look} --frames ${s.frames} --fps ${s.fps}`,
    host: { model, chip, os_version, os_build, power, load }, adapter: { name: s.adapter.name, backend: s.adapter.backend }, lease: s.lease,
  };
}

function listed(listing, model) {
  const alive = model.resources.filter((r) => r.dropped_at === null || r.dropped_at > model.lastSubmit);
  const taken = new Set();
  const rows = [];
  for (const m of listing.resources) {
    const same = (r) => !taken.has(r.id) && r.kind === m.kind && r.label === (m.label ?? '')
      && (m.kind === 'texture'
        ? r.size[0] === m.width && r.size[1] === m.height && r.mips === m.mip_levels && r.samples === m.sample_count
        : m.length >= r.size[0] && m.length < r.size[0] + 16);
    const r = alive.find(same) ?? model.resources.filter((x) => !alive.includes(x)).reverse().find(same);
    if (r) {
      taken.add(r.id);
      const { id, kind, label, size, mips, samples, format, usage } = r;
      rows.push(kind === 'texture' ? { id, kind, label, size, mips, samples, format, usage, bytes: m.bytes } : { id, kind, label, size, format: null, usage, bytes: m.bytes });
    } else if (m.kind === 'buffer' && (m.label ?? '').startsWith('(wgpu internal)')) {
      rows.push({ id: `i${m.seq}`, kind: 'buffer', label: m.label, size: [m.length], format: null, usage: ['internal'], bytes: m.bytes });
    } else throw Error(`the device lists ${m.kind} ${JSON.stringify(m.label)} (made ${m.seq}th, ${m.bytes} B), which the trace has no live resource for`);
  }
  const unlisted = alive.filter((r) => !taken.has(r.id) && !/^spike3031 frame /.test(r.label));
  if (unlisted.length) throw Error(`the trace holds ${unlisted.length} live resources the device didn't list: ${unlisted.slice(0, 5).map((r) => `${r.id} ${JSON.stringify(r.label)}`).join(', ')}`);
  return rows;
}

function solidsOf(pass, row, solids) {
  const batch = pass.draws.filter((d) => d.bundle !== null);
  if (pass.name !== 'scene3d.geometry') {
    const unnamed = pass.draws.filter((d) => d.depth_write && d.indexed);
    if (unnamed.length) throw Error(`pass ${pass.name} draws ${unnamed.length} meshes into depth that the renderer's counts don't name`);
    return new Map();
  }
  if (batch.length !== row.draws.length) throw Error(`the geometry pass issues ${batch.length} batch draws and the renderer names ${row.draws.length}`);
  return new Map(batch.map((d, i) => {
    const [item, , , instances] = row.draws[i];
    const first = solids.find((s) => s.id === item);
    const set = solids.filter((s) => first && s.layer === first.layer && s.shape === first.shape && s.feature_set === first.feature_set);
    if (!first || set[0] !== first || set.length !== instances || d.instances !== instances) throw Error(`the draw of ${item} has ${d.instances} instances, the renderer says ${instances}, and its set holds ${set.length} solids`);
    return [d, set.map((s) => s.id)];
  }));
}

function drew(pass, depthPass) {
  const by = new Map();
  for (const d of pass.draws) {
    const key = JSON.stringify([d.pipeline, depthPass && d.depth_write, d.indirect ? null : d.indices, d.indirect ? null : d.instances, d.indirect, d.cull]);
    by.set(key, (by.get(key) ?? 0) + 1);
  }
  return [...by].map(([key, n]) => { const [pipeline, depth, indices, instances, indirect, cull] = JSON.parse(key); return { pipeline, depth, indices, instances, indirect, cull, n }; });
}

function take(name) {
  const f = FIXTURES[name];
  if (!f) throw Error(`no fixture ${name}; one of ${NAMES.join(', ')}`);
  if (!existsSync(join(root, BIN))) throw Error(`BLOCKED: ${BIN} is not built: cargo build --release --locked in spikes/3031/`);
  const dir = mkdtempSync(join(tmpdir(), `spike3031-${name}-`));
  try {
    const ran = harness('frames', f, join(dir, 'frames'));
    const listing = JSON.parse(readFileSync(join(dir, 'frames', 'resources.json'), 'utf8'));
    const rows = lines(join(dir, 'frames', 'frames.jsonl'));
    const { solids } = JSON.parse(readFileSync(join(dir, 'frames', 'solids.json'), 'utf8'));
    const model = readTrace(join(dir, 'frames', 'trace', 'trace.ron'));
    if (model.failed.length) throw Error(`the trace holds failed commands: ${JSON.stringify(model.failed[0])}`);
    if (model.frames.length !== rows.length || model.frames.some((fr, k) => fr.frame !== k)) throw Error(`the trace marks ${model.frames.length} frames, the harness drew ${rows.length}`);
    const frames = model.frames.map((fr, k) => ({
      frame: k, t: rows[k].t / FLICKS, camera: { eye: rows[k].eye, forward: rows[k].forward },
      passes: fr.passes.map((p) => {
        const depthPass = p.touches.some((t) => t.how.includes('depth attachment'));
        const row = { name: p.name, reads: p.touches.filter((t) => t.reads).map((t) => t.id), writes: p.touches.filter((t) => t.writes).map((t) => t.id) };
        if (name === EVERY_PASS) return p.draws.length ? { ...row, drew: drew(p, depthPass) } : row;
        const named = solidsOf(p, rows[k], solids);
        return { ...row, draws: p.draws.map((d) => ({ solids: named.get(d) ?? [], depth: depthPass && d.depth_write })) };
      }),
    }));
    const { allocated, allocated_at_open, peak, estimate, on } = listing;
    const device = { allocated, allocated_at_open, peak, estimate, on, resources: listed(listing, model) };
    mkdirSync(join(here, 'out'), { recursive: true });
    writeFileSync(join(here, out(name, 'frames')), `${JSON.stringify({ ...head(name, f, ran), solids, device, frames })}\n`);

    const over = harness('overdraw', f, join(dir, 'overdraw'));
    const overdraw = lines(join(dir, 'overdraw', 'overdraw.jsonl')).map((r) => ({ t: r.t / FLICKS, camera: { eye: r.eye, forward: r.forward }, max_overdraw: r.max_overdraw, histogram: r.histogram }));
    writeFileSync(join(here, out(name, 'overdraw')), `${JSON.stringify({ ...head(name, f, over), overdraw })}\n`);
    console.log(`${name}: ${frames.length} frames, ${frames[0].passes.length} passes in the first; ${device.resources.length} resources, ${grouped(allocated)} B allocated; overdraw up to ${Math.max(...overdraw.map((r) => r.max_overdraw))}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function scan(frames) {
  return frames.map((f) => {
    const touched = new Map();
    f.passes.forEach((p, i) => {
      for (const id of new Set([...p.reads, ...p.writes])) {
        const t = touched.get(id);
        if (t) t.max = i;
        else touched.set(id, { min: i, max: i, readFirst: p.reads.includes(id) });
      }
    });
    return touched;
  });
}

function spansOf(per, id) {
  const spans = new Array(per.length).fill(null);
  let nextReads = false;
  for (let f = per.length - 1; f >= 0; f--) {
    const t = per[f].get(id);
    if (t) {
      spans[f] = { start: t.readFirst ? -Infinity : t.min, end: nextReads ? Infinity : t.max };
      nextReads = t.readFirst;
    } else if (nextReads) spans[f] = { start: -Infinity, end: Infinity };
  }
  return spans;
}
const meet = (a, b) => a.some((s, f) => s && b[f] && s.start <= b[f].end && b[f].start <= s.end);

function setsOf(resources, frames, usage = true) {
  const per = scan(frames);
  const bound = (id) => per.some((touched) => touched.has(id));
  const classes = new Map();
  for (const r of resources) {
    if (r.kind !== 'texture' || r.bytes === 0 || !bound(r.id)) continue;
    const key = JSON.stringify([r.size, r.mips, r.samples, r.format, usage ? [...r.usage].sort() : null]);
    classes.set(key, [...(classes.get(key) ?? []), { id: r.id, spans: spansOf(per, r.id) }]);
  }
  const sets = [];
  for (const members of classes.values()) {
    const here = [];
    for (const m of members) {
      const free = here.find((set) => set.every((other) => !meet(m.spans, other.spans)));
      if (free) free.push(m);
      else here.push([m]);
    }
    sets.push(...here.filter((set) => set.length > 1).map((set) => ({ targets: set.map((m) => m.id) })));
  }
  return sets;
}

function fixtureOf(name) {
  const kept = (kind) => {
    const path = join(here, out(name, kind));
    if (!existsSync(path)) throw Error(`BLOCKED: ${out(name, kind)} is not kept: node docs/spikes/3031/count.mjs take ${name}`);
    const text = readFileSync(path, 'utf8');
    return { run: JSON.parse(text), ref: { command: `node docs/spikes/3031/count.mjs take ${name}`, out: out(name, kind), sha256: sha256(text) } };
  };
  const [played, counted] = [kept('frames'), kept('overdraw')];
  const { device, frames } = played.run;
  const per = scan(frames);
  const ends = (id, end) => {
    const names = per.flatMap((touched, k) => (touched.has(id) ? [frames[k].passes[touched.get(id)[end]].name] : []));
    return names.length ? names[0] : null;
  };
  const targets = device.resources.map(({ id, label, kind, size, format, usage, bytes }) => ({ id, label, kind, size, format, usage, bytes, first: ends(id, 'min'), last: ends(id, 'max') }));
  const px = played.run.size[0] * played.run.size[1];
  const means = counted.run.overdraw.map((r) => Object.entries(r.histogram).reduce((s, [k, n]) => s + Number(k) * n, 0) / px);
  const fixture = {
    runs: { device: played.ref, passes: { ...played.ref }, overdraw: counted.ref },
    targets, sum_bytes: targets.reduce((s, r) => s + r.bytes, 0), allocated_bytes: device.allocated,
    sets: setsOf(device.resources, frames),
    overdraw: { mean: means.reduce((s, m) => s + m, 0) / means.length, largest: Math.max(...counted.run.overdraw.map((r) => r.max_overdraw)) },
  };
  if (name !== EVERY_PASS) {
    const solids = played.run.solids.filter((s) => /^(plain|opaque)/.test(s.feature_set) && !s.per_pixel && s.alpha >= 1).map((s) => s.id);
    fixture.depth_draws = solids.sort().map((solid) => {
      const times = frames.map((f) => f.passes.reduce((n, p) => n + p.draws.filter((d) => d.depth && d.solids.includes(solid)).length, 0));
      return { solid, least: Math.min(...times), most: Math.max(...times) };
    });
  }
  return { fixture, run: played.run };
}

function returned(fixture) {
  const bytes = new Map(fixture.targets.map((r) => [r.id, r.bytes]));
  return fixture.sets.reduce((sum, set) => { const b = set.targets.map((id) => bytes.get(id)); return sum + b.reduce((s, x) => s + x, 0) - Math.max(...b); }, 0);
}

function record() {
  const read = Object.fromEntries(NAMES.map((name) => [name, fixtureOf(name)]));
  const fixtures = Object.fromEntries(NAMES.map((name) => [name, read[name].fixture]));
  const mains = new Set(NAMES.map((name) => read[name].run.main));
  if (mains.size !== 1) throw Error(`the kept runs are of ${mains.size} commits: ${[...mains].join(', ')}`);
  const tasks = existsSync(join(here, 'tasks.json')) ? JSON.parse(readFileSync(join(here, 'tasks.json'), 'utf8')) : {};
  const sharing = Object.fromEntries(['showpiece', EVERY_PASS].map((name) => { const bytes = returned(fixtures[name]); return [name, { returns_bytes: bytes, at_least_32_mb: bytes >= SHARE_BYTES }]; }));
  const mean = Object.fromEntries(NAMES.map((name) => [name, fixtures[name].overdraw.mean]));
  const thresholds = {
    sharing: { ...sharing, task: tasks.sharing ?? null },
    overdraw: { mean, past_1_5: Object.values(mean).some((m) => m > OVERDRAW_PAST), task: tasks.overdraw ?? null },
  };
  writeFileSync(join(here, 'record.json'), `${JSON.stringify({ main: [...mains][0], fixtures, thresholds }, null, 1)}\n`);
  process.stdout.write(tables(read, fixtures, thresholds));
}

function tables(read, fixtures, thresholds) {
  const text = [];
  const every = fixtures[EVERY_PASS];
  const run = read[EVERY_PASS].run;
  const rows = new Map(every.targets.map((r) => [r.id, r]));
  const shape = (r) => (r.kind === 'texture' ? `${r.size[0]} × ${r.size[1]}${r.size[2] > 1 ? ` × ${r.size[2]}` : ''}` : `${grouped(r.size[0])} B`);
  const detail = new Map(run.device.resources.map((r) => [r.id, r]));
  const more = (r) => { const d = detail.get(r.id); return d.kind === 'texture' ? [d.samples > 1 ? `${d.samples} samples` : '', d.mips > 1 ? `${d.mips} mips` : ''].filter(Boolean).join(', ') : ''; };
  text.push('## Lines', '');
  text.push(`Targets on \`every_pass\`: ${grouped(every.sum_bytes)} B in the table, ${grouped(every.allocated_bytes)} B allocated on the device`);
  for (const name of ['showpiece', EVERY_PASS]) text.push(`Sharing on \`${name}\`: ${grouped(thresholds.sharing[name].returns_bytes)} B returned, at least 32 MB: ${thresholds.sharing[name].at_least_32_mb ? 'yes' : 'no'}`);
  const [top] = Object.entries(thresholds.overdraw.mean).sort((a, b) => b[1] - a[1]);
  text.push(`Overdraw: largest mean ${top[1].toFixed(2)} on \`${top[0]}\`, past 1.5: ${thresholds.overdraw.past_1_5 ? 'yes' : 'no'}`, '');

  text.push('## The every-pass scene\'s targets of 1 MB and more', '', '| Target | Size | Format | Usage | Device MB | First pass | Last pass |', '|---|---|---|---|---|---|---|');
  const big = every.targets.filter((r) => r.bytes >= 1e6).sort((a, b) => b.bytes - a.bytes);
  for (const r of big) text.push(`| \`${r.label}\` (${r.id}) | ${shape(r)}${more(r) ? `, ${more(r)}` : ''} | ${r.format ?? 'buffer'} | ${r.usage.join(', ')} | ${mb(r.bytes)} | ${r.first ?? 'none'} | ${r.last ?? 'none'} |`);
  const small = every.targets.filter((r) => r.bytes < 1e6);
  text.push(`| ${small.length} more, each under 1 MB (${small.filter((r) => r.kind === 'texture').length} textures, ${small.filter((r) => r.kind === 'buffer').length} buffers) | | | | ${mb(small.reduce((s, r) => s + r.bytes, 0))} | | |`);
  text.push(`| **${every.targets.length} rows** | | | | **${mb(every.sum_bytes)}** | | |`, '');

  text.push('## Sets', '');
  for (const name of NAMES) {
    const f = fixtures[name];
    const by = new Map(f.targets.map((r) => [r.id, r]));
    text.push(`- \`${name}\`: ${f.sets.length ? '' : 'none'}`);
    for (const set of f.sets) {
      const members = set.targets.map((id) => by.get(id));
      text.push(`  - ${members.map((r) => `\`${r.label}\` (${r.id}, ${r.first} to ${r.last})`).join(' + ')}: ${shape(members[0])}, ${members[0].format}, ${members[0].usage.join(' | ')}; returns ${mb(members.reduce((s, r) => s + r.bytes, 0) - Math.max(...members.map((r) => r.bytes)))} MB`);
    }
  }
  text.push('', '## Textures of one size and format whose usages differ and whose spans never meet (1 MB and more)', '');
  for (const set of setsOf(run.device.resources.filter((r) => r.bytes >= 1e6), run.frames, false)) {
    const members = set.targets.map((id) => rows.get(id));
    if (new Set(members.map((r) => r.usage.join('|'))).size > 1) text.push(`- ${members.map((r) => `\`${r.label}\` (${r.id}; ${r.usage.join(' | ')}; ${r.first} to ${r.last})`).join(' + ')}: ${shape(members[0])}, ${members[0].format}, ${mb(members[0].bytes)} MB each`);
  }
  text.push('');

  text.push('## Overdraw and depth draws', '', '| Fixture | Size | Frames | Mean overdraw | Over drawn pixels alone | Largest | Depth draws of each opaque solid |', '|---|---|---|---|---|---|---|');
  for (const name of NAMES) {
    const f = fixtures[name];
    const counted = JSON.parse(readFileSync(join(here, f.runs.overdraw.out), 'utf8'));
    const px = counted.size[0] * counted.size[1];
    const drawn = counted.overdraw.map((r) => { const cells = Object.entries(r.histogram); const on = px - (r.histogram['0'] ?? 0); return on ? cells.reduce((s, [k, n]) => s + Number(k) * n, 0) / on : 0; });
    const depth = f.depth_draws ? f.depth_draws.map((d) => `${d.solid} ${d.least === d.most ? d.least : `${d.least} to ${d.most}`}`).join(', ') : 'see below';
    text.push(`| \`${name}\` | ${counted.size.join(' × ')} | ${counted.overdraw.length} | ${f.overdraw.mean.toFixed(3)} | ${(drawn.reduce((s, m) => s + m, 0) / drawn.length).toFixed(3)} | ${f.overdraw.largest} | ${depth} |`);
  }
  text.push('');

  text.push('## The every-pass scene\'s draws into depth', '', '| Pass | Pipeline | Draw | A frame issues |', '|---|---|---|---|');
  const seen = new Map();
  run.frames.forEach((f, k) => {
    const here = new Map();
    for (const p of f.passes) for (const d of p.drew ?? []) if (d.depth) { const key = JSON.stringify([p.name, `${d.pipeline}${d.cull ? `, culls ${d.cull}` : ''}`, d.indirect ? 'indirect' : `${d.indices} indices × ${d.instances}`]); here.set(key, (here.get(key) ?? 0) + d.n); }
    for (const key of new Set([...seen.keys(), ...here.keys()])) { const all = seen.get(key) ?? new Array(k).fill(0); all[k] = here.get(key) ?? 0; seen.set(key, all); }
  });
  for (const [key, all] of seen) {
    const [pass, pipeline, draw] = JSON.parse(key);
    const filled = Array.from({ length: run.frames.length }, (_, k) => all[k] ?? 0);
    const [least, most] = [Math.min(...filled), Math.max(...filled)];
    text.push(`| ${pass} | ${pipeline} | ${draw} | ${least === most ? least : `${least} to ${most}`} |`);
  }
  text.push('');
  return `${text.join('\n')}\n`;
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'take') for (const name of rest.length ? rest : NAMES) take(name);
else if (command === 'record') record();
else {
  console.error('usage: node docs/spikes/3031/count.mjs take [fixture ...] | record');
  process.exit(2);
}
