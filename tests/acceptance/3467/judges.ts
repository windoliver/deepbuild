// The judges of the #3467 acceptance tests. Each decides one criterion from what a run of `deep-canvas-render`
// answered and, where the answer fails it, says why in words that name what the criterion names: the field, the sum,
// the frame, the count, the bytes. A judge reads the answer's JSON and nothing else: no process, no file, no clock and
// no test runner. So one function judges the shipped worker's run, a planted worker's run and a made-up answer, and a
// test's whole verdict on a run is `expect(judge(answer)).toBeNull()` (or `.toEqual([])`).

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
/** The call an answer came from: `idle`, the live view on the real clock, or `session`, whose steps carry their `t`. */
export type Call = 'idle' | 'session';

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
const whole = (v: JsonValue | undefined): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const brief = (v: JsonValue | undefined): string => (JSON.stringify(v) ?? 'nothing').slice(0, 240);
const secs = (flicks: number): string => `${(flicks / 705_600_000).toFixed(4)} s`;

/** Whether a call answered that it doesn't know the request's `planted` value (the base's answer to an unknown one). */
export const unknownPlant = (answer: JsonValue | undefined): boolean => isObject(answer) && answer['ok'] === false && answer['code'] === 'bad_input';

// ---------------------------------------------------------------------------------------------------
// What an answer holds (README: The surface under test). Each reader gives the rows, or why it can't, naming the field.

/** The `players` entry of video item `id`; `lacking` says what the caller can't read when the answer holds no such block. */
function playerOf(answer: JsonValue | undefined, id: string, call: Call, lacking: string): JsonObject | string {
  if (!isObject(answer) || answer['ok'] !== true) return `${call} didn't run the document: it answered ${brief(answer)}`;
  const players = answer['players'];
  if (!isObject(players)) return `${call}'s answer holds no \`players\` block, so ${lacking} (it holds ${Object.keys(answer).join(', ')})`;
  const player = players[id];
  if (!isObject(player)) return `${call}'s \`players\` block holds no video item ${id} (it holds ${Object.keys(players).join(', ') || 'none'})`;
  return player;
}

/** One request the player made of its decode worker: the frame asked for, and how many samples the worker decoded for it. */
export interface Request { frame: number; samples: number }
/** The `decodes` rows of item `id`, in the order asked. Every row must hold `samples`. */
export function requestsOf(answer: JsonValue | undefined, id: string, call: Call): Request[] | string {
  const player = playerOf(answer, id, call, 'it has no `decodes` row and none holds `samples`');
  if (typeof player === 'string') return player;
  const rows = player['decodes'];
  if (!Array.isArray(rows)) return `${call}'s players.${id} holds no \`decodes\` rows (${brief(rows)})`;
  const out: Request[] = [];
  const without: string[] = [];
  for (const [i, row] of rows.entries()) {
    if (!isObject(row) || !whole(row['frame'])) return `${call}'s players.${id}.decodes[${i}] names no \`frame\`: ${brief(row)}`;
    if (whole(row['samples'])) out.push({ frame: row['frame'], samples: row['samples'] });
    else without.push(`decodes[${i}] is ${brief(row)}`);
  }
  if (without.length) return `${without.length} of the ${rows.length} \`decodes\` rows of ${call}'s players.${id} hold no \`samples\`, the whole number of samples the worker decoded for that request: ${without[0]}`;
  return out;
}

/** One new source frame the item put on screen: the document time it was presented at, the frame, its planes' hash. */
export interface Shown { t: number; frame: number; planes: string | null; at_ms: number | null }
/** The `shown` rows of item `id`, in order. */
export function shownOf(answer: JsonValue | undefined, id: string, call: Call): Shown[] | string {
  const player = playerOf(answer, id, call, 'it has no `shown` row to name the frame on screen');
  if (typeof player === 'string') return player;
  const rows = player['shown'];
  if (!Array.isArray(rows)) return `${call}'s players.${id} holds no \`shown\` rows (${brief(rows)})`;
  const out: Shown[] = [];
  for (const [i, row] of rows.entries()) {
    if (!isObject(row) || !whole(row['frame']) || !whole(row['t'])) return `${call}'s players.${id}.shown[${i}] names no \`frame\` and \`t\`: ${brief(row)}`;
    const planes = row['planes'] ?? null;
    if (planes !== null && !(typeof planes === 'string' && /^[0-9a-f]{64}$/.test(planes))) return `${call}'s players.${id}.shown[${i}].planes is no lower-case SHA-256: ${brief(planes)}`;
    out.push({ t: row['t'], frame: row['frame'], planes, at_ms: typeof row['at_ms'] === 'number' ? row['at_ms'] : null });
  }
  return out;
}

/** The sum of the `samples` of every request of item `id`, or why it can't be read. */
export function samplesSum(answer: JsonValue | undefined, id: string, call: Call): number | string {
  const rows = requestsOf(answer, id, call);
  return typeof rows === 'string' ? rows : rows.reduce((sum, r) => sum + r.samples, 0);
}

// ---------------------------------------------------------------------------------------------------
// AC1: played forward through its whole span, the `samples` of the requests sum to at most the recording's samples.

/**
 * Null when the recording of `frames` frames (as many samples) played forward through its whole span and its requests'
 * `samples` sum to at most `frames`; else why, naming the field a row lacks or the sum. `every`: the run's clock is
 * the test's own, so each frame shows once, in order; without it the clock is the real one, which may skip frames, so
 * the frames shown rise from the first to the last. The sum can't be under the frames shown either: a frame is not
 * shown before its own sample is decoded, so a lower sum is no count of the worker's.
 */
export function judgePlay(answer: JsonValue | undefined, id: string, call: Call, frames: number, every: boolean): string | null {
  const rows = requestsOf(answer, id, call);
  if (typeof rows === 'string') return rows;
  const shown = shownOf(answer, id, call);
  if (typeof shown === 'string') return shown;
  const seen = shown.map((s) => s.frame);
  const rising = seen.every((f, i) => i === 0 || f > seen[i - 1]!);
  const through = every ? seen.length === frames && seen.every((f, i) => f === i) : rising && seen[0] === 0 && seen.at(-1) === frames - 1;
  if (!through) return `the recording didn't play forward through its whole span: ${seen.length} frames shown, ${every ? `not each of frames 0 to ${frames - 1} once, in order` : `not rising from frame 0 to frame ${frames - 1}`} (${brief(seen)})`;
  const sum = rows.reduce((total, r) => total + r.samples, 0);
  if (sum > frames) return `the \`samples\` of the ${rows.length} requests sum to ${sum}, over the ${frames} samples the recording holds: played forward, each sample is decoded once`;
  if (sum < seen.length) return `the \`samples\` of the ${rows.length} requests sum to ${sum}, under the ${seen.length} frames shown, each of which needs its own sample decoded: the rows don't count what the worker decoded`;
  return null;
}

// ---------------------------------------------------------------------------------------------------
// AC2: at each time jumped to, the frame shown has the planes the canonical decode of that frame gives.

/** A time jumped to (flicks), and the source frame whose presentation interval holds it. */
export interface Jump { t: number; frame: number }

/** "source frame k" for a hash among the canonical decode's, else the hash: how a failure names what was shown. */
export function nameFrame(canon: readonly string[], planes: string): string {
  const k = canon.indexOf(planes);
  return k >= 0 ? `source frame ${k}` : `no frame of the recording (planes ${planes.slice(0, 16)}…)`;
}

/**
 * Every jump, in the order made, whose frame on screen isn't the canonical decode's of the frame at that time; each
 * failure names that frame. `canon[k]` is the SHA-256 of the canonical decode's planes of source frame k. A `shown`
 * row belongs to the jump whose `t` it carries. A jump into the frame already on screen shows no new frame, so it
 * has no row, and the row that put the frame there was judged.
 */
export function judgeJumps(answer: JsonValue | undefined, id: string, jumps: readonly Jump[], canon: readonly string[]): string[] {
  const shown = shownOf(answer, id, 'session');
  if (typeof shown === 'string') return [shown];
  const at = new Map(shown.map((s) => [s.t, s]));
  const failures: string[] = [];
  jumps.forEach((jump, i) => {
    const where = `jump ${i + 1}, to ${jump.t} flicks (${secs(jump.t)})`;
    const row = at.get(jump.t);
    if (!row) {
      if (i === 0 || jumps[i - 1]!.frame !== jump.frame) failures.push(`${where}: the item shows no new frame, not source frame ${jump.frame}, the frame at that time`);
    } else if (row.planes === null) failures.push(`${where}: the frame shown carries no \`planes\` hash to hold against source frame ${jump.frame}, the frame at that time`);
    else if (row.planes !== canon[jump.frame]) failures.push(`${where}: the item shows ${nameFrame(canon, row.planes)}, not source frame ${jump.frame}, the frame at that time as the canonical decode gives it`);
  });
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// AC3: a jump forward decodes from the key frame before its target, not every frame it passes.

/**
 * Null when the one request for frame `to`, made when the last frame asked of the worker was `from`, decoded at most
 * `most` samples; else why, naming the count. `least` is the samples from the key frame before `to` through it: a
 * request past the last sample decoded starts no later than that key frame (Scope), so a lower count is no count of
 * the worker's.
 */
export function judgeJumpForward(answer: JsonValue | undefined, id: string, from: number, to: number, least: number, most: number): string | null {
  const rows = requestsOf(answer, id, 'session');
  if (typeof rows === 'string') return rows;
  const asked = rows.flatMap((r, i) => (r.frame === to ? [i] : []));
  if (asked.length !== 1) return `the requests hold ${asked.length} for frame ${to}, not the jump's one (frames asked: ${brief(rows.map((r) => r.frame))})`;
  const before = rows[asked[0]! - 1];
  if (before?.frame !== from) return `the jump to frame ${to} doesn't leave from frame ${from}: the request before it is ${before ? `for frame ${before.frame}` : 'none'} (frames asked: ${brief(rows.map((r) => r.frame))})`;
  const count = rows[asked[0]!]!.samples;
  if (count > most) return `the jump from frame ${from} to frame ${to} decoded ${count} samples, more than ${most}`;
  if (count < least) return `the jump from frame ${from} to frame ${to} decoded ${count} samples, fewer than the ${least} from its key frame through it: the row doesn't count what the worker decoded`;
  return null;
}

/** The `samples` of the one request for frame `to`, or null when the answer holds none or several. */
export function jumpCount(answer: JsonValue | undefined, id: string, to: number): number | null {
  const rows = requestsOf(answer, id, 'session');
  if (typeof rows === 'string') return null;
  const asked = rows.filter((r) => r.frame === to);
  return asked.length === 1 ? asked[0]!.samples : null;
}

// ---------------------------------------------------------------------------------------------------
// AC4: played forward, one sample a frame; a jump back decodes from the key frame before its target, no sample earlier.

/** The forward play of a run that then jumps back: the requests before the first one for a frame behind the one before it. */
function forwardOf(rows: Request[]): { forward: Request[]; turn: number } {
  const turn = rows.findIndex((r, i) => i > 0 && r.frame < rows[i - 1]!.frame);
  return { forward: turn < 0 ? rows : rows.slice(0, turn), turn };
}

/** The samples the forward play decoded and the frames it covers, or null when the answer can't be read. */
export function forwardSum(answer: JsonValue | undefined, id: string): { sum: number; frames: number } | null {
  const rows = requestsOf(answer, id, 'session');
  if (typeof rows === 'string' || rows.length === 0) return null;
  const { forward } = forwardOf(rows);
  return { sum: forward.reduce((total, r) => total + r.samples, 0), frames: forward.at(-1)!.frame - forward[0]!.frame + 1 };
}

/**
 * What is wrong with a run that plays a recording stored in order forward from frame `first` (a key frame) through
 * frame `last` and then jumps back to frame `back`, whose key frame is `key`: first the forward play, when its
 * requests didn't decode one sample a frame, naming the sum; then the jump back, when it didn't decode the samples
 * from `key` through `back` and no other. The jump's request is the first for a frame behind the one asked before
 * it; the requests before it are the forward play's, and the frames they cover run from the first asked to the last
 * (the frame asked ahead of the last one shown among them).
 */
export function judgeForwardAndBack(answer: JsonValue | undefined, id: string, first: number, last: number, back: number, key: number): string[] {
  const rows = requestsOf(answer, id, 'session');
  if (typeof rows === 'string') return [rows];
  const asked = brief(rows.map((r) => r.frame));
  const { forward, turn } = forwardOf(rows);
  if (forward.length === 0 || forward[0]!.frame !== first || forward.at(-1)!.frame < last) return [`the requests don't play frames ${first} to ${last} forward (frames asked: ${asked})`];
  if (turn < 0 || rows[turn]!.frame !== back) return [`the requests hold no jump back to frame ${back}: ${turn < 0 ? 'none is for a frame behind the one before it' : `the first behind the one before it is for frame ${rows[turn]!.frame}`} (frames asked: ${asked})`];
  const failures: string[] = [];
  const covered = forward.at(-1)!.frame - first + 1;
  const sum = forward.reduce((total, r) => total + r.samples, 0);
  if (sum !== covered) failures.push(`played forward, the ${forward.length} requests for frames ${first} to ${forward.at(-1)!.frame} decoded ${sum} samples, not one a frame (${covered})`);
  const want = back - key + 1;
  const got = rows[turn]!.samples;
  if (got > want) failures.push(`the jump back to frame ${back} decoded ${got} samples, ${got - want} more than the ${want} from the key frame before it, frame ${key}: it started at an earlier sample`);
  if (got < want) failures.push(`the jump back to frame ${back} decoded ${got} samples, not the ${want} from the key frame before it, frame ${key}, through it`);
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// AC5: the frame bytes the app and the worker hold together stay under the bound.

/** `frame_bytes` of item `id`: the most bytes of decoded frames each side held at one time. */
export function frameBytesOf(answer: JsonValue | undefined, id: string, call: Call): { app: number; worker: number } | string {
  const player = playerOf(answer, id, call, 'no item\'s `frame_bytes` can be read');
  if (typeof player === 'string') return player;
  const held = player['frame_bytes'];
  if (!isObject(held) || !whole(held['app']) || !whole(held['worker'])) return `${call}'s players.${id} holds no \`frame_bytes\` {app, worker}, the most bytes of decoded frames each side held at one time (${brief(held)})`;
  return { app: held['app'], worker: held['worker'] };
}

/**
 * Null when the recording of `frames` frames played through, each frame shown once in order, and the app and the
 * worker together held under `limit` bytes of frames; else why, naming the bytes. `frame` is one frame at the
 * player's size: the app holds the frame on screen and, on a recording stored out of presentation order, the worker
 * keeps a picture ahead of its turn, so a side that reports less counted no frame.
 */
export function judgeBytes(answer: JsonValue | undefined, id: string, frames: number, limit: number, frame: number): string | null {
  const held = frameBytesOf(answer, id, 'session');
  if (typeof held === 'string') return held;
  const shown = shownOf(answer, id, 'session');
  if (typeof shown === 'string') return shown;
  if (shown.length !== frames || shown.some((s, i) => s.frame !== i)) return `the recording didn't play through: ${shown.length} frames shown, not each of frames 0 to ${frames - 1} once, in order (${brief(shown.map((s) => s.frame))})`;
  const total = held.app + held.worker;
  if (total >= limit) return `the app and the worker together held ${total} bytes of frames (the app ${held.app}, the worker ${held.worker}), not under ${limit}`;
  if (held.app < frame || held.worker < frame) return `\`frame_bytes\` counts ${held.app} bytes in the app and ${held.worker} in the worker, a side under the ${frame} bytes of one frame at the player's size: it doesn't count the frames held`;
  return null;
}

// ---------------------------------------------------------------------------------------------------
// AC6: #499's five players, judged as #499's suite judges them (tests/acceptance/499/video/players.test.ts).

/** Null when one `idle` run drew a frame in [from, to) ms and none of those frames allocated; else why. */
export function allocsFailure(answer: JsonValue | undefined, from: number, to: number): string | null {
  if (!isObject(answer) || answer['ok'] !== true) return `idle didn't run the document: it answered ${brief(answer)}`;
  const drawn = answer['drawn'];
  if (!Array.isArray(drawn)) return `idle's answer holds no \`drawn\` frames (${brief(drawn)})`;
  const after: { frame: JsonValue | undefined; at_ms: number; allocs: number }[] = [];
  for (const [i, d] of drawn.entries()) {
    if (!isObject(d) || typeof d['at_ms'] !== 'number' || !whole(d['allocs'])) return `idle's drawn[${i}] holds no \`at_ms\` and \`allocs\`: ${brief(d)}`;
    if (d['at_ms'] >= from && d['at_ms'] < to) after.push({ frame: d['frame'], at_ms: d['at_ms'], allocs: d['allocs'] });
  }
  if (after.length === 0) return `no frame was drawn in [${from} ms, ${to} ms), so none shows what a frame allocates`;
  const bad = after.filter((d) => d.allocs !== 0);
  if (bad.length) return `${bad.length} of the ${after.length} frames drawn after warm-up allocate, the first frame ${brief(bad[0]!.frame)} at ${bad[0]!.at_ms.toFixed(1)} ms with ${bad[0]!.allocs} allocations`;
  return null;
}

/**
 * Null when the players `ids` together showed at least 150 frames a second less 0.5% in [from, to) ms, with under
 * 0.5% of the source frames due between the first and last shown skipped; else the reading.
 */
export function framesFailure(answer: JsonValue | undefined, ids: readonly string[], from: number, to: number): string | null {
  let shown = 0;
  let due = 0;
  const per: string[] = [];
  for (const id of ids) {
    const rows = shownOf(answer, id, 'idle');
    if (typeof rows === 'string') return rows;
    const frames = rows.filter((s) => s.at_ms !== null && s.at_ms >= from && s.at_ms < to).map((s) => s.frame);
    if (frames.some((f, i) => i > 0 && f <= frames[i - 1]!)) return `player ${id} showed its frames out of order`;
    const span = frames.length ? frames.at(-1)! - frames[0]! + 1 : 0;
    shown += frames.length;
    due += span;
    per.push(`${id} ${frames.length}/${span}`);
  }
  const dropped = due - shown;
  const rate = shown / ((to - from) / 1000);
  if (rate >= 150 * 0.995 && due > 0 && dropped / due < 0.005) return null;
  return `${shown} frames shown in ${(to - from) / 1000} s (${rate.toFixed(1)} a second), ${dropped} of ${due} dropped (${((100 * dropped) / Math.max(1, due)).toFixed(2)}%); shown/due per player: ${per.join(', ')}`;
}

/** What five runs of a timing say. */
export type Verdict = { verdict: 'PASS' } | { verdict: 'FAIL' | 'INCONCLUSIVE'; why: string };
/**
 * #854's rule over five runs of a timing: off a fit reference Mac (`unfit` says what is off) the runs are a reading,
 * INCONCLUSIVE, and so they are when the machine's 1-minute load was above its cores (`loadShare` over 1) or can't be
 * read, whether they passed or failed: a loaded run counts neither way (technical design: How runs become one of five
 * verdicts). Else PASS when all five pass, FAIL when all five fail, and INCONCLUSIVE when they disagree.
 */
export function judgeFive(failures: readonly (string | null)[], unfit: readonly string[], loadShare: number): Verdict {
  if (failures.length !== 5) return { verdict: 'INCONCLUSIVE', why: `a timing is judged over five runs, not ${failures.length}` };
  const off = [...unfit, ...(loadShare <= 1 ? [] : [`the 1-minute load is ${loadShare.toFixed(2)} times the cores, and a loaded run counts neither way`])];
  if (off.length) return { verdict: 'INCONCLUSIVE', why: `reading only (${off.join('; ')})` };
  if (failures.every((f) => f === null)) return { verdict: 'PASS' };
  const list = failures.map((f, i) => `run ${i + 1}: ${f ?? 'pass'}`).join('; ');
  if (failures.every((f) => f !== null)) return { verdict: 'FAIL', why: list };
  return { verdict: 'INCONCLUSIVE', why: `the five runs disagree: ${list}` };
}
