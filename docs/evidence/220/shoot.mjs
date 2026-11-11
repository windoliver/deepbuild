// The #220 taste pictures and the proof film, drawn by the canvas from typeset jobs' outputs and taken from the
// exported files of `deep-show run`:
//   five-parts.png     a^2 + b^2 = c^2 as the typeset job wrote it, in dark_math, each of its five part groups boxed
//   match-morph.png    the 1 s match_morph from a^2 + b^2 = c^2 to a^2 = c^2 - b^2 halfway, at 0.5 s
//   match-morph.apng   the match_morph's exported frames, 24 a second, from just before its window to just after
//   proof.apng         the circle-area proof: five steps whose shared terms move, with a θ label in the math role
//   failures.json      the three planted failures: \ce, a part split across two, and an alt that says another formula
// The formulas come from the typeset tool itself (packages/jobs/typeset/tool), the same bytes `deep_job` keeps, since
// qualification holds the tool to its fixtures byte for byte. Prints each file's SHA-256. Run from the repository
// root after `node scripts/typeset-wasm.mjs` and
// `cargo build --locked --bin deep-show --no-default-features --features full`; needs ffmpeg on PATH.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { typeset } from '../../../packages/jobs/typeset/tool/typeset.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const BIN = join(REPO, 'target', 'debug', 'deep-show');
const evidence = mkdtempSync(join(tmpdir(), 'deep-220-shoot-'));
const work = mkdtempSync(join(tmpdir(), 'deep-220-out-'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const put = (bytes) => { const h = sha(bytes); mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true }); writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes); return h; };
const SIZE = [960, 540];
const K = 5; // u per SVG unit
const DEFAULTS = { syntax: 'latex_math', display: true, font: 'new_computer_modern_math', macros: [] };

/** A typeset job's outputs: the SVG, put in the store, and its probe. */
function job(parts) {
  const a = typeset({ ...DEFAULTS, parts: parts.map((source) => ({ source })) });
  if (a.failed || !a.svg) throw Error(`typeset ${JSON.stringify(parts)}: ${a.failed ?? a.probe}`);
  return { src: put(Buffer.from(a.svg)), probe: JSON.parse(a.probe) };
}

const look = put(readFileSync(join(REPO, 'crates/deep-canvas-marks/looks/dark_math.json')));
const film = (id, items, extra = {}, span = '2s') => ({
  format: 1, id, profile: 'film', title: `#220 ${id}`, description: `The #220 taste film ${id}.`, size: SIZE, camera: 'cam',
  transport: { span, frame_rate: [24, 1] }, look: { asset: 'dark_math' }, assets: { dark_math: { sha256: look } },
  requires: { modules: { vector: '^1' } },
  items: Object.fromEntries([
    { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [SIZE[0] / 2, SIZE[1] / 2, 0], view_width: SIZE[0] } },
    { id: 'back', kind: 'rect@1', name: 'Back', order: 'a1', params: { box: [-400, -400, SIZE[0] + 800, SIZE[1] + 800], paint: { fill: { role: 'ground' } } } },
    ...items,
  ].map((i) => [i.id, i])),
  ...extra,
});
/** A vector item of a typeset output, centred on the frame, `K` u a unit. */
function formula(id, out, order, y = SIZE[1] / 2) {
  const [w, h] = out.probe.size;
  return { id, kind: 'vector@1', name: `Formula ${id}`, order, params: { src: out.src, size: [w * K, h * K], colors: { currentColor: 'ink' } }, at: { pos: [(SIZE[0] - w * K) / 2, y - (h * K) / 2, 0] } };
}
const morph = (from, to, at) => ({ from, to, kind: 'match_morph', at, span: '1s', progress: 'linear', match_morph: {} });

// 1. a^2 + b^2 = c^2, its five part groups boxed from the job's own probe.
const F1 = job(['a^2', '+', 'b^2', '=', 'c^2']);
const F2 = job(['a^2', '=', 'c^2', '-', 'b^2']);
const eq = formula('eq', F1, 'b0');
const boxes = F1.probe.parts.map((p, i) => ({
  id: `box${i}`, kind: 'rect@1', name: `Part ${p.id}`, order: `c${i}`,
  params: { box: [eq.at.pos[0] + p.box[0] * K - 6, eq.at.pos[1] + p.box[1] * K - 6, p.box[2] * K + 12, p.box[3] * K + 12], paint: { stroke: { role: 'accent', width: 2 } } },
}));
const PARTS = film('parts', [eq, ...boxes]);

// 2. The 1 s match_morph from one formula to the other, its window 0.5 s to 1.5 s.
const MORPH = film('morph', [formula('fa', F1, 'b0'), formula('fb', F2, 'b1')], { transitions: { mm: morph('fa', 'fb', '1s') } });

// 3. The circle-area proof: unroll the circle into a triangle of base C and height r, then simplify, each step a
// typeset job and each change a match_morph; a θ beside the sector, set in the look's math role.
const STEPS = [
  ['A', '=', '\\frac{1}{2}', 'C', 'r'],
  ['A', '=', '\\frac{1}{2}', '(2\\pi r)', 'r'],
  ['A', '=', '\\pi', 'r', 'r'],
  ['A', '=', '\\pi', 'r^2'],
  ['\\pi', 'r^2', '=', 'A'],
].map(job);
const proofItems = STEPS.map((s, i) => formula(`s${i}`, s, `b${i}`, SIZE[1] * 0.72));
// Arcs as polylines, 64 to a turn: the path reader takes M, L, C, Q and Z.
const arc = (r, a, n) => Array.from({ length: n + 1 }, (_, i) => `${(r * Math.cos((a * i) / n)).toFixed(2)} ${(-r * Math.sin((a * i) / n)).toFixed(2)}`);
const sector = (r, a) => `M 0 0 L ${arc(r, a, 12).join(' L ')} Z`;
const ring = (r) => `M ${arc(r, 2 * Math.PI, 64).join(' L ')} Z`;
const PROOF = film('proof', [
  { id: 'disc', kind: 'path@1', name: 'Disc', order: 'a2', params: { d: ring(110), paint: { stroke: { role: 'muted', width: 2 } } }, at: { pos: [SIZE[0] / 2, 170, 0] } },
  { id: 'wedge', kind: 'path@1', name: 'Sector', order: 'a3', params: { d: sector(110, 0.6), paint: { fill: { role: 'accent' } } }, at: { pos: [SIZE[0] / 2, 170, 0] } },
  { id: 'theta', kind: 'text@1', name: 'θ', order: 'a4', params: { text: 'θ', font: 'math', size: 28, box: { w: 40, h: 40 } }, at: { pos: [SIZE[0] / 2 + 40, 118, 0] } },
  ...proofItems,
], { transitions: Object.fromEntries(STEPS.slice(1).map((_, i) => [`m${i}`, morph(`s${i}`, `s${i + 1}`, `${1.5 + 2 * i}s`)])) }, '9s');

// 4. The planted failures: each is the job's issue, as the plug-in's output checks read it from the probe.
const failures = {
  unknown_command: JSON.parse(typeset({ ...DEFAULTS, parts: [{ source: '\\ce{H2O}' }] }).probe).issues,
  parts_apart: JSON.parse(typeset({ ...DEFAULTS, parts: [{ source: 'e^{i' }, { source: '\\pi}' }] }).probe).issues,
};

const DOC = (n) => `01JB220S${String(n).padStart(18, '0')}`;
const docs = { [DOC(1)]: PARTS, [DOC(2)]: MORPH, [DOC(3)]: PROOF };
const present = (doc, document) => ({ call: 'deep show', peer: { pid: 3002, start: 3000 }, doc, document, include: ['issues'] });
const calls = [
  ...Object.entries(docs).map(([id, d]) => present(id, d)),
  { call: 'export', doc: DOC(1), out: join(work, 'parts'), range: ['0f', '1f'], video: { codec: 'png_seq' } },
  { call: 'export', doc: DOC(2), out: join(work, 'morph'), range: ['0f', '49f'], video: { codec: 'png_seq' } },
  { call: 'export', doc: DOC(3), out: join(work, 'proof'), range: ['0f', '216f'], video: { codec: 'png_seq' } },
  // The alt planted wrong: the same output, its alt saying c^3.
  present(DOC(4), film('alt', [{ ...formula('eq', F1, 'b0'), params: { ...formula('eq', F1, 'b0').params, alt: 'a^2+b^2=c^3' } }])),
];
const scenario = {
  evidence, sessions: {}, panels: { main: { rect: [0, 0, 1920, 1080] } },
  docs: Object.fromEntries([1, 2, 3, 4].map((n) => [DOC(n), { panel: 'main' }])),
  processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3000 }],
  calls,
};
const r = spawnSync(BIN, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
if (r.status !== 0) throw Error(`deep-show run exited ${r.status}: ${r.stderr.slice(-2000)}`);
const answer = JSON.parse(r.stdout.trim().split('\n')[0]);
if (!answer.ok) throw Error(`deep-show run refused the scenario: ${r.stdout.slice(0, 2000)}`);
const replies = answer.replies;
replies.slice(0, 3).forEach((s, i) => { if (s.outcome !== 'presented') throw Error(`film ${i + 1} isn't presented: ${JSON.stringify(s).slice(0, 1500)}`); });
replies.slice(3, 6).forEach((s, i) => { if (s.outcome !== 'exported') throw Error(`export ${i + 1}: ${JSON.stringify(s).slice(0, 1500)}`); });
const altIssue = (replies[6].issues ?? []).filter((i) => i.code === 'formula.alt_mismatch');
if (!altIssue.length) throw Error(`the planted alt raised no formula.alt_mismatch: ${JSON.stringify(replies[6]).slice(0, 1500)}`);
failures.alt_mismatch = altIssue;

const pngs = (name) => readdirSync(join(work, name)).filter((f) => f.endsWith('.png')).sort().map((f) => join(work, name, f));
const ffmpeg = (args) => { const x = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args]); if (x.status !== 0) throw Error(`ffmpeg ${args.join(' ')}: ${x.stderr}`); };
const apng = (name, out) => {
  const first = pngs(name)[0];
  const pattern = first.replace(/\d+\.png$/, (m) => `%0${m.length - 4}d.png`);
  const start = Number(first.match(/(\d+)\.png$/)[1]);
  ffmpeg(['-framerate', '24', '-start_number', String(start), '-i', pattern, '-plays', '0', '-f', 'apng', join(HERE, out)]);
};
const morphFrames = pngs('morph');
copyFileSync(pngs('parts')[0], join(HERE, 'five-parts.png'));
// The window opens at frame 12 (0.5 s) and closes at 36 (1.5 s): halfway is frame 24.
copyFileSync(morphFrames[24], join(HERE, 'match-morph.png'));
apng('morph', 'match-morph.apng');
apng('proof', 'proof.apng');
writeFileSync(join(HERE, 'failures.json'), `${JSON.stringify(failures, null, 2)}\n`);

for (const f of ['five-parts.png', 'match-morph.png', 'match-morph.apng', 'proof.apng', 'failures.json']) {
  console.log(`${f}  ${sha(readFileSync(join(HERE, f)))}`);
}
