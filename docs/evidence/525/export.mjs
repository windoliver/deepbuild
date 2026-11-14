// Exports the #525 drop lab as a film with its sound: `node export.mjs <deep-show> <out dir>`.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [bin, dir] = process.argv.slice(2);
const RATE = 48000, SEC = 705600000;
const ev = join(dir, 'evidence');
mkdirSync(ev, { recursive: true });
const wav = (hz, frames, amp) => { const b = Buffer.alloc(44 + 2 * frames); b.write('RIFF', 0); b.writeUInt32LE(36 + 2 * frames, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(2 * frames, 40); for (let i = 0; i < frames; i++) b.writeInt16LE(Math.round(amp * Math.cos(2 * Math.PI * hz * i / RATE) * 32767), 44 + 2 * i); const sha = createHash('sha256').update(b).digest('hex'); mkdirSync(join(ev, sha.slice(0, 2)), { recursive: true }); writeFileSync(join(ev, sha.slice(0, 2), sha.slice(2)), b); return sha; };
const bed = wav(220, RATE, 0.25), clack = wav(1000, RATE / 20, 0.5);
const m = (r) => ({ friction: 0.5, restitution: r, density: 1000 });
const world = { kind: 'physics.world@1', dimensions: 3, step_rate: 120, substeps: 4, gravity: [0, -9.81, 0], seed: 525, mode: 'dynamic', capacity: { bodies: 4, shapes: 4, joints: 0, contacts: 16, particles: 0 }, backend: { name: 'rapier3d', version: '=0.36.1' }, contact_materials: { stone: m(0.5), rubber: m(0.5) }, shapes: { floor: { kind: 'box', half: [2, 0.1, 2] }, ball: { kind: 'sphere', radius: 0.1 } }, bodies: { floor: { kind: 'static', shapes: [{ shape: 'floor', contact_material: 'stone' }], pose: { pos: [0, -0.1, 0] } }, ball: { kind: 'dynamic', shapes: [{ shape: 'ball', contact_material: 'rubber' }], pose: { pos: [0, 1.1, 0] }, sleep: false } }, outputs: { ball: { from: 'ball', read: 'pose', to: 'items/ball/at' } } };
const item = (id, order, kind, params, at) => ({ id, name: id, order, kind, params, ...(at ? { at } : {}) });
const doc = {
  format: 1, profile: process.env.PROFILE ?? 'film', title: 'Drop lab', description: 'The #525 lab: a ball dropped on a floor, a clack on each hit.', size: [640, 360], camera: 'cam',
  transport: { span: '3s', frame_rate: [60, 1], sample_rate: RATE }, requires: { modules: { scene3d: '^1' } },
  items: {
    cam: item('cam', 'a0', 'camera@1', { projection: 'perspective', position: [0, 0.55, 3.2], target: [0, 0.55, 0], fov: 60, near: 0.1, far: 100 }),
    floor: item('floor', 'a2', 'mark.box@1', { size: [4, 0.2, 4], paint: { fill: { role: 'muted' } } }, { pos: [0, -0.1, 0] }),
    ball: item('ball', 'a3', 'mark.sphere@1', { size: [0.2, 0.2, 0.2], paint: { fill: { role: 'accent' } } }),
  },
  worlds: { lab: world },
  strips: { bed: { track: 0, src: { asset: bed }, start: 0, in: 0, out: SEC, loop: true, pan: -1 } },
  spawns: { clack: { on: { list: 'lab.occurrences', kinds: ['hit'] }, play: { src: { asset: clack }, in: 0, out: SEC / 20 }, pan: 1 } },
};
writeFileSync(join(dir, 'doc.json'), JSON.stringify(doc, null, 1));
const DOC = '01JB525F1LM00000000000000A';
const scenario = { evidence: ev, sessions: { 'sess-alpha': { thread: 'thread-alpha', name: 'Claude Code: physics lab', process: { pid: 4100, start: 1000 } } },
  processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 4100, ppid: 3001, start: 1000 }],
  panels: { main: { rect: [0, 0, 800, 600] } }, docs: { [DOC]: { panel: 'main' } },
  calls: [{ call: 'deep_show', session: 'sess-alpha', doc: DOC, document: doc, include: ['issues'] },
    { call: 'export', doc: DOC, out: join(dir, 'lab.mov'), video: { codec: 'h264' }, audio: { codec: 'pcm' } },
    { call: 'media_mix', doc, segments: [{ from: 0, to: 3 * SEC, write: true }] }] };
const r = spawnSync(bin, ['run'], { input: JSON.stringify(scenario) + '\n', encoding: 'utf8', maxBuffer: 1 << 30 });
writeFileSync(join(dir, 'reply.json'), r.stdout);
const out = JSON.parse(r.stdout.trim());
const rep = out.replies ?? [];
console.log(JSON.stringify({ ok: out.ok, code: out.code, presented: rep[0]?.outcome, issues: (rep[0]?.issues ?? []).slice(0, 4), export: rep[1]?.outcome ?? rep[1], receipt: rep[1]?.receipt && { size: rep[1].receipt.size, frames: rep[1].receipt.frames, audio: rep[1].receipt.audio, runtime_digest: rep[1].receipt.runtime_digest, pcm_hashes: rep[1].receipt.pcm_hashes?.slice?.(0, 2) }, mix: rep[2]?.mix?.segments?.[0] && { sha: rep[2].mix.segments[0].sha256, wav: rep[2].mix.segments[0].wav }, voices: (rep[2]?.mix?.voices ?? []).slice(0, 6).map((v) => v.start / (SEC / RATE)) }, null, 1).slice(0, 3000));
