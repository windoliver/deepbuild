// Bakes each world of the film's document (doc.json, from export.mjs) with `deep-physics` at one sample a step, and
// writes readings.json and readings.html (charts of the joint readings the film can't draw yet, #2248):
// `node readings.mjs <deep-physics> <out dir>`.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [bin, dir] = process.argv.slice(2);
const doc = JSON.parse(readFileSync(join(dir, 'doc.json'), 'utf8'));
const STEPS = 360;
const FLICK = 705600000;
const calls = Object.keys(doc.worlds).map((id) => ({ call: 'bake', scene: doc, world: id, steps: STEPS, frame_rate: '120/1' }));
// The disc (criterion 5) isn't drawn: at 5,400 deg/s it turns 90° a frame at 60 fps.
const disc = { ...doc.worlds.flywheel, bodies: { fly: { ...doc.worlds.flywheel.bodies.fly, velocity: { angular: [0, 0, 7200] } } } };
calls.push({ call: 'bake', world: disc, steps: 120, frame_rate: '120/1' });
const torso = (hand) => ({ ...doc.worlds.limit, gravity: [0, -9.81, 0], contact_materials: { skin: { friction: 0.5, restitution: 0, density: 1000 } },
  shapes: { palm: { kind: 'box', half: [0.05, 0.05, 0.01] }, chest: { kind: 'box', half: [0.15, 0.3, 0.1] } },
  bodies: { torso: { kind: 'dynamic', shapes: [{ shape: 'chest', contact_material: 'skin' }], pose: { pos: [0, 1, 0] }, mass: 40 },
    hand: { kind: 'dynamic', shapes: [{ shape: 'palm', contact_material: 'skin' }], pose: { pos: [0, 0.65, 0] }, ...(hand ? { mass: hand } : {}) } },
  joints: { wrist: { kind: 'hinge', a: 'torso', b: 'hand', frame_a: { anchor: [0, -0.3, 0], axis: [1, 0, 0] }, frame_b: { anchor: [0, 0.05, 0], axis: [1, 0, 0] } } }, outputs: {} });
calls.push({ call: 'check', world: torso() }, { call: 'check', world: torso(5) }, { call: 'check', world: torso(4) });
const run = spawnSync(bin, [], { input: calls.map((c) => JSON.stringify(c)).join('\n') + '\n', encoding: 'utf8', maxBuffer: 1 << 30 });
const replies = run.stdout.trim().split('\n').map((l) => JSON.parse(l));
const ids = Object.keys(doc.worlds);
const bake = Object.fromEntries(ids.map((id, i) => [id, replies[i]]));
const series = (id, out) => bake[id].outputs.series[out];
const rows = (id) => bake[id].occurrences ?? [];
const r3 = (x) => Math.round(x * 1000) / 1000;
const faults = (reply) => (reply.occurrences ?? []).filter((r) => r.kind === 'fault').map((r) => ({ step: r.step, a: r.a, kind: r.fault.kind }));

const fly = series('flywheel', 'spin');
const armS = series('arm', 'shoulder_at'), armE = series('arm', 'elbow_at');
const L = series('pulley', 'left_at'), R = series('pulley', 'right_at');
const gA = doc.worlds.pulley.joints.rope.pulley.ground_a, gB = doc.worlds.pulley.joints.rope.pulley.ground_b;
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const sum = L.map((p, k) => dist(p, gA) + dist(R[k], gB));
const discTurn = replies[ids.length].outputs.series.spin;
const out = {
  flywheel: { at3s: r3(fly[360]), rises: fly.every((v, k) => k === 0 || v > fly[k - 1]), crossings: rows('flywheel').filter((r) => r.kind === 'crossing').map((r) => ({ t_s: r3(r.t / FLICK), level: r.level, direction: r.direction })) },
  disc: { faults: faults(replies[ids.length]).slice(0, 3), degPerStep: r3(discTurn[60] - discTurn[59]) },
  limit: { breaks: rows('limit').filter((r) => r.kind === 'break').map((r) => ({ step: r.step, a: r.a, torque: r3(r.torque) })), torqueBefore: series('limit', 'load').slice(1, 6).map((s) => r3(s.torque)) },
  pressed: { breaks: rows('pressed').filter((r) => r.kind === 'break').length, forceAt2s: r3(series('pressed', 'load')[240].force), torqueAt2s: r3(series('pressed', 'load')[240].torque) },
  hanging: { breaks: rows('hanging').filter((r) => r.kind === 'break').map((r) => ({ step: r.step, a: r.a, force: r3(r.force) })), forceStep1: r3(series('hanging', 'load')[1].force) },
  gears: { inAt2s: r3(series('gears', 'turn_in')[240]), outAt2s: r3(series('gears', 'turn_out')[240]) },
  pulley: { worstSumError: Math.max(...sum.map((s) => Math.abs(s - sum[0]))), leftYAt3s: r3(L[360][1]) },
  arm: { jams: rows('arm').filter((r) => r.kind === 'fault').slice(0, 3).map((r) => ({ step: r.step, a: r.a, kind: r.fault.kind })), jamSteps: rows('arm').filter((r) => r.kind === 'fault').length,
    around2s: [236, 238, 240, 241, 242, 244, 248, 260, 300, 360].map((k) => ({ step: k, shoulder: r3(armS[k]), elbow: r3(armE[k]) })) },
  massRatio: replies.slice(ids.length + 1).map((c) => (c.issues ?? []).filter((i) => i.code === 'physics.mass_ratio').map((i) => ({ ids: i.ids, ratio: r3(i.ratio) }))),
};
writeFileSync(join(dir, 'readings.json'), JSON.stringify(out, null, 1));

// Charts: one SVG per reading over the 3 s, steps on x.
const chart = (title, lines, { yMin, yMax, marks = [] }) => {
  const W = 600, H = 220, P = 40;
  const x = (k) => P + (k / STEPS) * (W - 2 * P);
  const y = (v) => H - P - ((v - yMin) / (yMax - yMin)) * (H - 2 * P);
  const paths = lines.map(([vals, color]) => `<polyline fill="none" stroke="${color}" stroke-width="2" points="${vals.map((v, k) => `${x(k).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/>`).join('');
  const ticks = [0, 1, 2, 3].map((s) => `<text x="${x(s * 120)}" y="${H - P + 16}" font-size="11" text-anchor="middle">${s} s</text>`).join('');
  const ylab = [yMin, yMax].map((v) => `<text x="${P - 4}" y="${y(v) + 4}" font-size="11" text-anchor="end">${v}</text>`).join('');
  const m = marks.map(([k, text]) => `<line x1="${x(k)}" x2="${x(k)}" y1="${P}" y2="${H - P}" stroke="#c33" stroke-dasharray="4 3"/><text x="${x(k) + 4}" y="${P + 12}" font-size="11" fill="#c33">${text}</text>`).join('');
  return `<figure><figcaption>${title}</figcaption><svg width="${W}" height="${H}"><rect x="${P}" y="${P}" width="${W - 2 * P}" height="${H - 2 * P}" fill="none" stroke="#bbb"/>${paths}${ticks}${ylab}${m}</svg></figure>`;
};
const crossing = out.flywheel.crossings[0];
const jam = out.arm.jams[0];
const html = `<!doctype html><meta charset="utf-8"><style>body{font:13px system-ui;margin:16px;background:#fff}figure{display:inline-block;margin:6px}figcaption{font-weight:600}</style>
<h3>#523 readings, baked by deep-physics at one sample a step (the film can't draw joint readings yet, #2248)</h3>
${chart(`flywheel joint_coordinate (deg): ${out.flywheel.at3s}° at 3 s`, [[fly, '#2563eb']], { yMin: 0, yMax: 1100, marks: crossing ? [[crossing.t_s * 120, `crossing 90°, +1, ${crossing.t_s} s`]] : [] })}
${chart(`two-link arm: shoulder (blue) and elbow (orange), deg`, [[armS, '#2563eb'], [armE, '#ea580c']], { yMin: -130, yMax: 70, marks: jam ? [[jam.step, `jam at step ${jam.step}, ${jam.a}`]] : [] })}
${chart('gear: drive (blue) and driven (orange), deg', [[series('gears', 'turn_in'), '#2563eb'], [series('gears', 'turn_out'), '#ea580c']], { yMin: 0, yMax: 600 })}
${chart('joint_force torque, arm on its limit (N·m)', [[series('limit', 'load').map((s) => s.torque), '#2563eb']], { yMin: 0, yMax: 60, marks: out.limit.breaks[0] ? [[out.limit.breaks[0].step, `break, step ${out.limit.breaks[0].step}`]] : [] })}
<pre>${JSON.stringify(out, null, 1)}</pre>`;
writeFileSync(join(dir, 'readings.html'), html);
console.log(JSON.stringify(out, null, 1));
