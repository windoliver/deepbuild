// The judges of the #3507 acceptance tests: each decides one criterion from what a test read, and returns its
// findings as sentences that start with one of the four states (FAIL: the program says otherwise; BLOCKED: a reading
// is missing or unrun; INCONCLUSIVE: what was read can't decide; INVALID: not in the shape the README gives). No
// judge draws, reads a file or starts a process: drive.mjs does, and the scratch checks of this suite's first draft
// ran every judge here on good and wrong inputs (README: What was checked).
//
// Nothing here is a value from a run. The numbers are the issue's (1 and 2 a covered pixel; 300 frames; 1.1; 1.05; no
// higher than the merge base's; five rounds) and the fixtures' own geometry.

/**
 * Each criterion's ID: the first 8 hex digits of the SHA-256 of its text, as scripts/proof-change.mjs reads it.
 * Criterion 2 has none here: the owner reworded it on 2026-11-26, and its ID is with its test, in
 * tests/acceptance/3507-redraft-ac2/.
 */
export const AC = { 1: '#3507.f9beb02c', 3: '#3507.dc916f1d', 4: '#3507.f3ae7c70', 5: '#3507.25e79c7f' };

/** #3031's frames: 300 of them, 5 a second, frame k at k ÷ 5 s of the document's clock (docs/spikes/3031/count.mjs). */
export const FRAMES = 300;
export const FPS = 5;
/** Frame k's time as a document writes one: `0s`, `0.2s`, … `59.8s`. */
export const timeOf = (k) => `${Math.floor(k / FPS)}${k % FPS ? `.${(k % FPS) * 2}` : ''}s`;

/** The six budget classes, by the name of each one's perf-lane fixture, `benchmarks/canvas/<class>.json`. */
export const CLASSES = ['core_view', 'data_view', 'figure', 'work_product', 'showpiece', 'export'];

/** Criterion 3's two lines (the issue: "passes 1.1 a covered pixel"; "at most 1.05 there"). */
export const PAST = 1.1;
export const AT_MOST = 1.05;
/** A mean of 300 quotients carries the rounding of its sum: a count is past a line only by more than this. */
const ROUNDING = 1e-12;
const past = (count, line) => count > line + ROUNDING;
/** The ways the Scope gives a pass to change, as the report's `Geometry pass:` line names them, and the way that is none. */
export const WAYS = ["occluders' depth", 'depth pass', 'nearest first'];
export const UNCHANGED = 'unchanged';

const whole = (v) => Number.isSafeInteger(v) && v >= 0;
const brief = (v, n = 600) => (JSON.stringify(v) ?? 'undefined').slice(0, n);
const fixed = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
export const stateOf = (problem) => /^(FAIL|BLOCKED|INCONCLUSIVE|INVALID)\b/.exec(problem)?.[1] ?? 'FAIL';

// ---------------------------------------------------------------------------------------------------------------------
// One frame's reading, from the overdraw mode's reply (README: The surface under test)

/**
 * What one `mode: "overdraw"` reply says of its frame: `{ok: true, max, shaded, covered, pixels}`, or `{ok: false,
 * state, why}`. `size` is the size the call asked for. The reply's `drawn` holds one row `{"id": "frame", "what":
 * "overdraw", "max": n, "shaded": n, "covered": n}`: `max` is the base's (the most fragments any pixel took, depth
 * ignored); `shaded` and `covered` are this issue's, whole numbers of fragments and of pixels.
 */
export function readingOf(reply, size) {
  const no = (state, why) => ({ ok: false, state, why });
  if (reply === null || typeof reply !== 'object') return no('BLOCKED', `no reply: ${brief(reply)}`);
  if (reply.code === 'unsupported_platform') return no('BLOCKED', 'the build reports unsupported_platform: there is no GPU to count on, and without one the count is never a pass');
  if (reply.outcome !== 'presented') return no('BLOCKED', `the overdraw mode drew no frame: ${brief(reply)}`);
  const snapshot = Array.isArray(reply.snapshots) ? reply.snapshots[0] : undefined;
  if (!snapshot || snapshot.w !== size[0] || snapshot.h !== size[1]) return no('FAIL', `the mode's snapshot is ${brief(snapshot)}, not ${size[0]} × ${size[1]} px`);
  const rows = (Array.isArray(reply.drawn) ? reply.drawn : []).filter((r) => r && r.id === 'frame' && r.what === 'overdraw');
  if (rows.length !== 1) return no('FAIL', `the reply's drawn holds ${rows.length} rows {"id": "frame", "what": "overdraw"}, not one: ${brief(reply.drawn)}`);
  const [row] = rows;
  if (!whole(row.max)) return no('FAIL', `the frame row's max, the mode's own count, is ${brief(row.max)}, not a whole number: ${brief(row)}`);
  if (!whole(row.shaded) || !whole(row.covered)) {
    return no('FAIL', `the overdraw view gives no count of what the geometry pass shades: its frame row is ${brief(row)}, with no whole numbers "shaded" (fragments) and "covered" (pixels) beside "max"`);
  }
  const pixels = size[0] * size[1];
  if (row.covered > pixels) return no('FAIL', `the frame row says an opaque solid covers ${row.covered} pixels of a frame of ${pixels}: more than one sample a pixel was counted`);
  if (row.shaded > 0 && row.covered === 0) return no('FAIL', `the frame row counts ${row.shaded} fragments and no covered pixel`);
  return { ok: true, max: row.max, shaded: row.shaded, covered: row.covered, pixels };
}

// ---------------------------------------------------------------------------------------------------------------------
// Criterion 1: two walls that face the camera, one wholly behind the other

/** The two orders, as a failure names them, and the count a covered pixel the criterion gives each. */
export const ORDERS = { 'the nearer drawn first': 1, 'the farther drawn first': 2 };
/**
 * The walls' pixels, from the fixture alone (fixtures/two-walls.*.json): each wall is 4 m × 3 m, facing an
 * orthographic camera that looks along −Z at their middle with 8 m across a frame of 320 × 240 px, so 40 px a metre:
 * 160 × 120 px, edges on pixel edges, no pixel centre on one.
 */
export const WALL = { size: [320, 240], covered: 160 * 120 };

/**
 * `readings` is `{[order]: readingOf(...)}` for both orders. The count is the criterion's a covered pixel in each
 * order, over exactly the pixels the walls cover; each failure names its order.
 */
export function wallProblems(readings) {
  const problems = [];
  for (const [order, expected] of Object.entries(ORDERS)) {
    const r = readings?.[order];
    const where = `two walls, ${order}`;
    if (!r) { problems.push(`BLOCKED: ${where}: not counted`); continue; }
    if (!r.ok) { problems.push(`${r.state}: ${where}: ${r.why}`); continue; }
    if (r.covered !== WALL.covered) {
      problems.push(`FAIL: ${where}: the count says an opaque solid covers ${r.covered} pixels; the walls cover ${WALL.covered} (4 m × 3 m at 40 px a metre), at one sample a pixel`);
      continue;
    }
    if (r.shaded !== expected * r.covered) {
      problems.push(`FAIL: ${where}: the count is ${fixed(r.shaded / r.covered)} a covered pixel (${r.shaded} fragments over ${r.covered} covered pixels), not ${expected}`);
    }
  }
  return problems;
}

/**
 * What the planted count, which leaves the depth test out, must show under the same check: it reads 2 a covered pixel
 * both ways, and `wallProblems` fails it naming the order it gets wrong, the nearer drawn first. Returns what is wrong
 * with that, nothing when the planted count fails as the criterion says.
 */
export function plantedWallProblems(readings) {
  const out = [];
  for (const order of Object.keys(ORDERS)) {
    const r = readings?.[order];
    if (!r?.ok) { out.push(`${r?.state ?? 'BLOCKED'}: the planted count, ${order}: ${r?.why ?? 'not counted'}`); continue; }
    if (r.covered === 0 || r.shaded !== 2 * r.covered) out.push(`FAIL: the planted count, ${order}: it reads ${r.covered ? fixed(r.shaded / r.covered) : 'no'} a covered pixel (${r.shaded} fragments over ${r.covered}), not the 2 a count with no depth test reads both ways`);
  }
  if (out.length) return out;
  const problems = wallProblems(readings);
  const nearer = problems.filter((p) => p.startsWith('FAIL: two walls, the nearer drawn first:') && p.endsWith('not 1'));
  if (nearer.length !== 1) out.push(`FAIL: the check passes the planted count, or fails it without naming the order: it found ${brief(problems)}`);
  if (problems.length !== nearer.length) out.push(`FAIL: the check fails the planted count on more than the order it gets wrong: ${brief(problems)}`);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Criterion 2 as first written (1 a covered pixel; reworded since): each class's fixture, where no bar hides another

/**
 * `readings[k]` is frame k's reading of one class's fixture, k from 0 to 299. In every frame: the mode's own count is
 * 2 at most, a bar's front and its back with depth ignored, so no pixel holds two bars and no bar hides another (the
 * criterion's "where"; a frame where one does can't be judged, and is never a pass); a bar is in view; and the count
 * is 1 a covered pixel, fragment for pixel.
 */
export function classProblems(name, readings) {
  const problems = [];
  for (let k = 0; k < FRAMES; k++) {
    const r = readings?.[k];
    const where = `${name}, frame ${k} (${timeOf(k)})`;
    if (!r) { problems.push(`BLOCKED: ${where}: not counted; the criterion is every one of the ${FRAMES} frames`); continue; }
    if (!r.ok) { problems.push(`${r.state}: ${where}: ${r.why}`); continue; }
    if (r.max !== 2) {
      problems.push(`INCONCLUSIVE: ${where}: the mode's own count is at most ${r.max} a pixel, where a bar alone takes 2 (its front and its back, depth ignored): ${r.max > 2 ? 'a bar hides another here' : 'no bar is whole in view'}, and the criterion states the count for a frame where no bar hides another`);
      continue;
    }
    if (r.covered === 0) { problems.push(`FAIL: ${where}: the count says no opaque solid covers a pixel, and the mode's own count drew the bars`); continue; }
    if (r.shaded !== r.covered) problems.push(`FAIL: ${where}: the count is ${fixed(r.shaded / r.covered)} a covered pixel (${r.shaded} fragments over ${r.covered} covered pixels), not 1`);
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------------
// Criterion 3: the count for #3031's every-pass fixture, the report, and the branch

/**
 * A fixture's count over its frames, as #3031 took its means: each frame's fragments over the frame's pixels, and
 * over the pixels an opaque solid covers, averaged over the frames. `{problems}` when a frame wasn't counted or covers
 * nothing, else `{aPixel, aCoveredPixel, frames}`.
 */
export function countOf(name, readings, frames = FRAMES) {
  const problems = [];
  let aPixel = 0; let aCoveredPixel = 0;
  for (let k = 0; k < frames; k++) {
    const r = readings?.[k];
    const where = `${name}, frame ${k} (${timeOf(k)})`;
    if (!r) problems.push(`BLOCKED: ${where}: not counted`);
    else if (!r.ok) problems.push(`${r.state}: ${where}: ${r.why}`);
    else if (r.covered === 0) problems.push(`BLOCKED: ${where}: no opaque solid covers a pixel, so the frame has no count a covered pixel`);
    else { aPixel += r.shaded / r.pixels; aCoveredPixel += r.shaded / r.covered; }
  }
  return problems.length ? { problems } : { problems, aPixel: aPixel / frames, aCoveredPixel: aCoveredPixel / frames, frames };
}

const SHADED = /^.*Shaded on `every_pass`( before)?: (\d+\.\d{3,}) a covered pixel, (\d+\.\d{3,}) a pixel, over (\d+) frames\b.*$/gm;
const PASS = /^.*Geometry pass: (unchanged|occluders' depth|depth pass|nearest first)\b(.*)$/gm;
const TIMES = /p50 (\d+(?:\.\d+)?) ms before and (\d+(?:\.\d+)?) ms after/;

/**
 * The lines a test reads of the report, `docs/evidence/3507/README.md` (README: The report): `{problems, after,
 * before, way, ms}`. `after` and `before` are `{aCoveredPixel, aPixel, frames}` or null; `way` is one of WAYS or
 * UNCHANGED; `ms` is `{before, after}` or null.
 */
export function reportOf(text) {
  const problems = [];
  if (typeof text !== 'string') return { problems: ['FAIL: the report, docs/evidence/3507/README.md, is not there: nothing gives the count for #3031\'s every-pass fixture or says whether a pass changed'], after: null, before: null, way: null, ms: null };
  const counts = [...text.matchAll(SHADED)].map((m) => ({ before: m[1] !== undefined, aCoveredPixel: Number(m[2]), aPixel: Number(m[3]), frames: Number(m[4]) }));
  const pick = (before) => {
    const found = counts.filter((c) => c.before === before);
    if (found.length > 1) problems.push(`INVALID: the report has ${found.length} lines "Shaded on \`every_pass\`${before ? ' before' : ''}: …"; one is read`);
    return found.length === 1 ? found[0] : null;
  };
  const after = pick(false); const before = pick(true);
  if (!after && !counts.some((c) => !c.before)) problems.push('FAIL: the report gives no count for #3031\'s every-pass fixture: no line "Shaded on `every_pass`: <n.nnn> a covered pixel, <n.nnn> a pixel, over 300 frames"');
  const passes = [...text.matchAll(PASS)];
  if (passes.length !== 1) problems.push(`${passes.length ? 'INVALID' : 'FAIL'}: the report has ${passes.length} lines "Geometry pass: unchanged | occluders' depth | depth pass | nearest first"; one says whether a pass changed and which way it took`);
  const way = passes.length === 1 ? passes[0][1] : null;
  const t = passes.length === 1 ? TIMES.exec(passes[0][2]) : null;
  return { problems, after, before, way, ms: t ? { before: Number(t[1]), after: Number(t[2]) } : null };
}

const near = (a, b) => Math.abs(a - b) <= 0.0005 + 1e-9;

/**
 * The report against the test's own count of the every-pass fixture, `own` (countOf), with the report's text. The
 * count the report gives is the one the view gives here; then the branch: past 1.1 a covered pixel no report may say
 * a pass is unchanged, a changed pass brings the count to at most 1.05, and at 1.1 or under the report says no pass
 * changed. The count is never taken from the report: `own` decides.
 */
export function reportProblems(text, own) {
  const report = reportOf(text);
  const problems = [...report.problems];
  if (own.problems.length) return [...own.problems.slice(0, 10), ...problems];
  const mine = `${fixed(own.aCoveredPixel)} a covered pixel, ${fixed(own.aPixel)} a pixel, over ${own.frames} frames`;
  if (report.after) {
    if (report.after.frames !== FRAMES) problems.push(`FAIL: the report's count is over ${report.after.frames} frames, not the ${FRAMES} #3031 counted`);
    if (!near(report.after.aCoveredPixel, own.aCoveredPixel) || !near(report.after.aPixel, own.aPixel)) {
      problems.push(`FAIL: the report gives ${fixed(report.after.aCoveredPixel)} a covered pixel and ${fixed(report.after.aPixel)} a pixel for the every-pass fixture; the view counts ${mine}`);
    }
  }
  if (report.way === null) return problems;
  if (report.way === UNCHANGED) {
    if (past(own.aCoveredPixel, PAST)) problems.push(`FAIL: the count on the every-pass fixture is ${fixed(own.aCoveredPixel)} a covered pixel, past ${PAST}, and the report says the geometry pass is unchanged: past ${PAST} the change brings it to at most ${AT_MOST}`);
    if (report.before) problems.push('INVALID: the report says the geometry pass is unchanged and gives a count before: with no pass changed there is one count');
  } else {
    if (past(own.aCoveredPixel, AT_MOST)) problems.push(`FAIL: the report says the geometry pass changed (${report.way}), and the count on the every-pass fixture is ${fixed(own.aCoveredPixel)} a covered pixel, above the ${AT_MOST} a changed pass brings it to`);
    if (!report.before) problems.push('FAIL: the report says the geometry pass changed and gives no count before: no line "Shaded on `every_pass` before: …"');
    if (!report.ms) problems.push('FAIL: the report says the geometry pass changed and gives no time before and after: its line reads "Geometry pass: <way>, p50 <n> ms before and <n> ms after"');
    else if (!(report.ms.before > 0) || !(report.ms.after > 0)) problems.push(`INVALID: the report's times are ${report.ms.before} ms before and ${report.ms.after} ms after; each is above 0`);
    else if (report.ms.after > report.ms.before) problems.push(`FAIL: the report's own times say the geometry pass's p50 rose, ${report.ms.before} ms before and ${report.ms.after} ms after: it is no higher than the merge base's`);
  }
  return problems;
}

/**
 * The count before, where the report says a pass changed: `twin` is countOf over the every-pass fixture's 300 frames
 * drawn under the planted `geometry_pass_at_merge_base`, the merge base's pass kept as a wrong program. It is past
 * 1.1 a covered pixel, or no pass was to change; and it is the count the report gives as before.
 */
export function beforeProblems(text, twin) {
  const report = reportOf(text);
  if (report.way === null || report.way === UNCHANGED) return [];
  if (twin.problems.length) return twin.problems.slice(0, 10);
  const problems = [];
  if (!past(twin.aCoveredPixel, PAST)) problems.push(`FAIL: the report says the geometry pass changed (${report.way}), and what the merge base's pass shades on the every-pass fixture is ${fixed(twin.aCoveredPixel)} a covered pixel: at ${PAST} or under no pass changes`);
  if (report.before && (!near(report.before.aCoveredPixel, twin.aCoveredPixel) || !near(report.before.aPixel, twin.aPixel) || report.before.frames !== twin.frames)) {
    problems.push(`FAIL: the report gives ${fixed(report.before.aCoveredPixel)} a covered pixel and ${fixed(report.before.aPixel)} a pixel before, over ${report.before.frames} frames; the merge base's pass counts ${fixed(twin.aCoveredPixel)} and ${fixed(twin.aPixel)}, over ${twin.frames}`);
  }
  return problems;
}

/**
 * "No pass changes", as far as a frame says what it draws: `change` and `base` are the two builds' `view3d` replies
 * for the same call (`timings` and `counts` on), each `{passes, frames: [{frame, passes_ms, draws, indirect_draws,
 * encoded}]}`. The reply's pass list, each frame's timed passes and each frame's draws are the merge base's.
 */
export function samePassProblems(change, base) {
  const problems = [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const [side, r] of [['this checkout', change], ['the merge base', base]]) {
    if (!r || !Array.isArray(r.frames) || r.frames.length === 0) problems.push(`BLOCKED: ${side}'s build drew no frame of the every-pass fixture: ${brief(r)}`);
  }
  if (problems.length) return problems;
  if (!same(change.passes, base.passes)) problems.push(`FAIL: the report says no pass changed, and the frame's pass list is ${brief(change.passes)}, on the merge base ${brief(base.passes)}`);
  if (change.frames.length !== base.frames.length) problems.push(`FAIL: this checkout drew ${change.frames.length} frames and the merge base ${base.frames.length} from one call`);
  change.frames.forEach((f, i) => {
    const b = base.frames[i];
    if (!b) return;
    const where = `the every-pass fixture, frame ${f.frame}`;
    for (const side of [f, b]) if (side.passes_ms === null || typeof side.passes_ms !== 'object' || !Array.isArray(side.draws)) { problems.push(`BLOCKED: ${where}: a build's frame has no passes_ms or no draws (timings and counts were asked for): ${brief(side, 300)}`); return; }
    const [mine, theirs] = [Object.keys(f.passes_ms).sort(), Object.keys(b.passes_ms).sort()];
    if (!same(mine, theirs)) problems.push(`FAIL: the report says no pass changed; ${where} times the passes ${brief(mine)}, on the merge base ${brief(theirs)}`);
    for (const key of ['draws', 'indirect_draws', 'encoded']) {
      if (!same(f[key], b[key])) problems.push(`FAIL: the report says no pass changed; ${where}: its ${key} are ${brief(f[key], 400)}, on the merge base ${brief(b[key], 400)}`);
    }
  });
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------------
// Criterion 3's timing: the geometry pass's p50 over five alternated rounds

export const GEOMETRY_PASS = 'scene3d.geometry';
export const ROUNDS = 5;

/** The median of `values` (the mean of the middle two of an even count). */
export function p50(values) {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * One side's p50 of the geometry pass over one round: `reply` is its `view3d` reply with `timings`, which holds the
 * time `scene3d.geometry` took in every one of the round's frames. `{ms}` or `{problem}`.
 */
export function roundOf(reply, frames, what) {
  const list = Array.isArray(reply?.frames) ? reply.frames : null;
  if (!list || list.length !== frames) return { problem: `BLOCKED: ${what}: the reply holds ${list ? list.length : 'no'} frames, not the ${frames} of the round: ${brief(reply, 400)}` };
  const times = [];
  for (const f of list) {
    const ms = f?.passes_ms?.[GEOMETRY_PASS];
    if (!Number.isFinite(ms) || ms <= 0) return { problem: `BLOCKED: ${what}: frame ${f?.frame} has no time for ${GEOMETRY_PASS} in passes_ms: ${brief(f?.passes_ms, 300)}` };
    times.push(ms);
  }
  return { ms: p50(times) };
}

/**
 * The five rounds judged: `rounds[k]` is `{change, base, first, load: {start, end}}`, each side's p50 in ms and which
 * side drew first; `judgeLimit` is the perf lane's (scripts/benchmark.mjs) and `machine` its fingerprint. The change's
 * p50 over the merge base's is at most 1 in each round, by the design's rule for a timing: PASS when all five are
 * within it, FAIL when all five are over by more than the margin, anything else, and any machine or load that can't
 * judge a time, INCONCLUSIVE. Returns `{problems, verdict}`; a pass is no problem.
 */
export function timingProblems(rounds, judgeLimit, machine) {
  if (!Array.isArray(rounds) || rounds.length !== ROUNDS) return { problems: [`BLOCKED: the timing is ${ROUNDS} rounds after a warm-up, and ${Array.isArray(rounds) ? rounds.length : 'none'} were taken`], verdict: null };
  const firsts = rounds.map((r) => r.first);
  if (firsts.some((f, k) => f !== (k % 2 === 0 ? 'change' : 'base'))) return { problems: [`INVALID: the rounds don't alternate which side draws first: ${firsts.join(', ')}`], verdict: null };
  const ratios = rounds.map((r) => r.change / r.base);
  const verdict = judgeLimit({ limit: 1, runs: ratios, fingerprint: machine, loads: rounds.map((r) => r.load) });
  const shown = `the geometry pass's p50 on the every-pass fixture, this checkout's over the merge base's, per round: ${rounds.map((r) => `${fixed(r.change)} ÷ ${fixed(r.base)} ms = ${fixed(r.change / r.base)}`).join('; ')}`;
  if (verdict.status === 'PASS') return { problems: [], verdict, shown };
  if (verdict.status === 'FAIL') return { problems: [`FAIL: the geometry pass's p50 is higher than the merge base's: ${shown}; ${verdict.reason}`], verdict, shown };
  return { problems: [`${verdict.status === 'BLOCKED' ? 'BLOCKED' : 'INCONCLUSIVE'}: ${shown}; ${verdict.reason}; this is a reading, not a pass`], verdict, shown };
}

// ---------------------------------------------------------------------------------------------------------------------
// Criterion 4: every frame of the five suites hashes the same as on the merge base

/** The five suites the criterion names. */
export const SUITES = ['418', '424', '428', '465', '1637'];

/**
 * `rows` are the recorder's (record.mjs), one for each child process of a suite's run whose output held a
 * `pixel_hash`: `{file, child, command, args, kind, own, base, note}`. `kind` is `paired` (this checkout's own debug
 * build, drawn again by the merge base's from the same input), `planted` (a suite's own wrong program), `other_build`
 * (not the build `cargo build --locked --bin <name>` leaves in this checkout) or `no_twin`. Every paired frame hashes
 * as the merge base's does; a frame one side drew and the other didn't fails; and a suite none of whose frames was
 * paired is BLOCKED, never a pass.
 */
export function hashProblems(suite, rows) {
  const problems = [];
  let frames = 0;
  for (const r of rows) {
    const where = `tests/acceptance/${suite}/${r.file}, child ${r.child} (${r.command} ${(r.args ?? []).join(' ')})`;
    if (r.kind === 'lease_lost') { problems.push(`BLOCKED: tests/acceptance/${suite}/: ${r.note}; what was drawn after it isn't under the lease`); continue; }
    if (r.kind === 'no_twin') { problems.push(`BLOCKED: ${where}: the merge base's checkout has no build to draw it again: ${r.note}`); continue; }
    if (r.kind !== 'paired') continue;
    if (!Array.isArray(r.own) || !Array.isArray(r.base)) { problems.push(`INVALID: ${where}: the record holds no two lists of hashes`); continue; }
    if (r.own.length !== r.base.length) {
      problems.push(`FAIL: ${where}: this checkout drew ${r.own.length} hashed frames and the merge base's build ${r.base.length} from the same input${r.note ? ` (${r.note})` : ''}`);
      continue;
    }
    r.own.forEach((h, k) => {
      frames += 1;
      if (h !== r.base[k]) problems.push(`FAIL: ${where}, frame ${k}: hashes ${h}, on the merge base ${r.base[k]}`);
    });
  }
  if (frames === 0) problems.push(`BLOCKED: tests/acceptance/${suite}/: no frame was drawn by both builds, so nothing was compared`);
  return { problems, frames };
}

// ---------------------------------------------------------------------------------------------------------------------
// Criterion 5: no acceptance test is edited

/**
 * `nameStatus` is `git diff --name-status --no-renames <merge base> -- tests/acceptance` in the checkout: every file
 * under tests/acceptance/ that differs from the merge base, working tree included. A file the merge base holds is
 * as the merge base has it: only additions (`A`) are let through, and a file untracked is one of those.
 */
export function editedProblems(nameStatus) {
  const problems = [];
  for (const line of String(nameStatus).split('\n')) {
    if (line.trim() === '') continue;
    const [status, ...rest] = line.split('\t');
    const path = rest.join('\t');
    if (status === 'A') continue;
    const how = { M: 'edited', D: 'deleted', T: 'changed in type' }[status[0]] ?? `changed (${status})`;
    problems.push(`FAIL: ${path} is ${how}: the merge base holds it, and no acceptance test is edited`);
  }
  return problems;
}
