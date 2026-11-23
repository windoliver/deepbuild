// Validates the #1834 evidence runs (out/fired, out/late) and writes out/validation.json.
// For each run: the launch the bake keeps (step, source), the first world step after which the ball moves, the scene's
// ball at each frame against the world's ball after step 2f, and the first exported frame whose pixels differ from frame 0.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
const LOGIC_STEP = 705_600_000 / 70; // flicks
const WORLD_STEP = 705_600_000 / 120;
const expectAt = (k) => Math.ceil((k * LOGIC_STEP) / WORLD_STEP);

function run(name) {
  const r = JSON.parse(readFileSync(join(OUT, name, 'replies.json'), 'utf8'));
  const launches = (r.bake.inputs ?? []).filter((e) => e.kind === 'launch');
  const bodies = r.world.bodies;
  // bodies: one entry per state (after k steps); find the ball's state in each.
  const ballAt = (k) => bodies.ball[k];
  const pos = (b) => b?.pos ?? b?.position ?? b?.pose?.pos;
  const vel = (b) => b?.linear ?? b?.velocity?.linear ?? b?.linvel;
  let moved = null;
  for (let k = 0; k < bodies.ball.length; k++) {
    const v = vel(ballAt(k));
    if (v && Math.hypot(...v) > 0.05) { moved = k; break; }
  }
  const frameErr = r.ball.map((p, f) => {
    const want = pos(ballAt(2 * f));
    return Math.max(...p.map((x, j) => Math.abs(x - want[j])));
  });
  const files = readdirSync(join(OUT, name, 'frames')).filter((f) => f.endsWith('.png')).sort();
  const hash = (f) => createHash('sha256').update(readFileSync(join(OUT, name, 'frames', f))).digest('hex');
  const h0 = hash(files[0]);
  let firstChanged = null;
  for (let i = 1; i < files.length; i++) if (hash(files[i]) !== h0) { firstChanged = i; break; }
  const x = Array.from({ length: bodies.ball.length }, (_, k) => pos(ballAt(k))?.[0] ?? null);
  return {
    name,
    launches: launches.map((l) => ({ step: l.step, from: l.from, input: l.input, linear: l.data?.linear })),
    first_moving_state: moved,
    frame_vs_world_max_error_m: Math.max(...frameErr),
    frames: files.length,
    first_changed_frame: firstChanged,
    ball_x_by_step: x,
    step_hashes: r.world.step_hashes,
  };
}

const fired = run('fired');
const late = run('late');
const firstDiff = fired.step_hashes.findIndex((h, k) => h !== late.step_hashes[k]);
const out = {
  expected: { launch_step: expectAt(240), late_launch_step: expectAt(241) },
  fired, late,
  hashes_first_differ_at_state: firstDiff,
  hashes_equal_before: firstDiff === -1 ? null : fired.step_hashes.slice(0, firstDiff).every((h, k) => h === late.step_hashes[k]),
};
writeFileSync(join(OUT, 'validation.json'), JSON.stringify(out, null, 1));
const brief = (r) => ({ launches: r.launches, first_moving_state: r.first_moving_state, frame_err: r.frame_vs_world_max_error_m, frames: r.frames, first_changed_frame: r.first_changed_frame });
console.log(JSON.stringify({ expected: out.expected, fired: brief(fired), late: brief(late), hashes_first_differ_at_state: firstDiff }, null, 1));
