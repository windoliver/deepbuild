// The #3467 acceptance tests' fixtures as recipes, and what each must come out as (README: Fixtures). Nothing here
// starts a process or reads a file: a recipe is a list of ffmpeg arguments, and a fixture is checked from what
// ffprobe printed about it. So the same recipe and the same check run in a test and in a probe.
//
// Three recordings, all 30 frames a second in an MP4 whose video time base is 1/15360, so frame k is presented at
// 512k ticks = k/30 s = k × 23,520,000 flicks, a whole number:
//
// - `REORDERED` (criteria 1 and 2): 250 frames, 320 × 240, two B-frames between reference frames, one key frame.
// - `IN_ORDER` (criteria 3 and 4): 1,800 frames (60 s), 320 × 240, no B-frame, a key frame every 30 frames.
// - `REORDERED_4K` (criterion 5): `REORDERED`'s encode at 3840 × 2160.

/** Flicks in a second (canvas primitives: Time and the flick). */
export const FLICKS = 705_600_000;
/** Every fixture's frame rate, and one frame's length in flicks. */
export const FPS = 30;
export const FRAME_FLICKS = FLICKS / FPS;
/** The video time base's denominator, and one frame's length in its ticks. */
export const TIMESCALE = 15_360;
const TICKS = TIMESCALE / FPS;

/** A fixture: its size, its frames, the B-frames between two reference frames (0 or 2), and its key frame interval. */
export interface Recipe { name: string; width: number; height: number; frames: number; bframes: 0 | 2; keyint: number }

export const REORDERED: Recipe = { name: 'reordered', width: 320, height: 240, frames: 250, bframes: 2, keyint: 250 };
export const IN_ORDER: Recipe = { name: 'in-order', width: 320, height: 240, frames: 1800, bframes: 0, keyint: 30 };
export const REORDERED_4K: Recipe = { ...REORDERED, name: 'reordered-4k', width: 3840, height: 2160 };

/**
 * ffmpeg's arguments for a fixture, after its own global flags: the test pattern (every frame differs) encoded by
 * libx264 with a fixed number of B-frames (`-b_strategy 0`: the encoder never chooses fewer), none of them a
 * reference (`b-pyramid=none`), and a key frame only where the interval puts one (`-sc_threshold 0`). Tagged BT.709,
 * limited range. ffmpeg's own edit list is kept: with B-frames it is what puts frame 0 at time 0.
 */
export function recipeArgs(r: Recipe, path: string): string[] {
  return [
    '-y', '-f', 'lavfi', '-i', `testsrc2=size=${r.width}x${r.height}:rate=${FPS}`, '-frames:v', String(r.frames),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-bf', String(r.bframes), '-b_strategy', '0', '-g', String(r.keyint), '-sc_threshold', '0',
    '-x264-params', 'b-pyramid=none', '-pix_fmt', 'yuv420p',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
    '-video_track_timescale', String(TIMESCALE), path,
  ];
}

/** The document time, in flicks, at which frame k starts (the item plays from 0 at rate 1). */
export const frameTime = (k: number): number => k * FRAME_FLICKS;
/** The frame whose presentation interval holds document time t. */
export const frameAt = (r: Recipe, t: number): number => Math.min(r.frames - 1, Math.max(0, Math.floor(t / FRAME_FLICKS)));
/** The frames that are key frames. */
export const keyFrames = (r: Recipe): number[] => Array.from({ length: Math.ceil(r.frames / r.keyint) }, (_, i) => i * r.keyint);
/** The last key frame at or before frame k. */
export const keyBefore = (r: Recipe, k: number): number => Math.floor(k / r.keyint) * r.keyint;

/**
 * The frame each stored sample holds, in the order the file stores them. Without B-frames a file is stored in
 * presentation order. With two, each reference frame is stored ahead of the two frames shown before it: frames
 * 0, 3, 1, 2, 6, 4, 5, … (the fixture's frames number one more than a multiple of three, so no group is cut short).
 */
export function storedOrder(r: Recipe): number[] {
  if (r.bframes === 0) return Array.from({ length: r.frames }, (_, k) => k);
  const order = [0];
  for (let p = 3; p < r.frames; p += 3) order.push(p, p - 2, p - 1);
  return order;
}

/** What ffprobe printed of a fixture's video stream (`-of json`): the stream, its packets as stored, its frames as shown. */
export interface Probe {
  timeBase: string; width: number; height: number;
  packets: { pts: number; key: boolean }[];
  frames: { pts: number; type: string; key: boolean }[];
}
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const rows = (v: Json | undefined, key: string): { [key: string]: Json }[] => {
  const list = typeof v === 'object' && v !== null && !Array.isArray(v) ? v[key] : undefined;
  return Array.isArray(list) ? list.filter((x): x is { [key: string]: Json } => typeof x === 'object' && x !== null && !Array.isArray(x)) : [];
};
/** A probe from ffprobe's three answers: `-show_entries stream=…`, `-show_entries packet=pts,flags`, `-show_entries frame=pts,pict_type,key_frame`. */
export function probeOf(stream: Json, packets: Json, frames: Json): Probe {
  const s = rows(stream, 'streams')[0] ?? {};
  return {
    timeBase: String(s['time_base']), width: Number(s['width']), height: Number(s['height']),
    packets: rows(packets, 'packets').map((p) => ({ pts: Number(p['pts']), key: String(p['flags']).includes('K') })),
    frames: rows(frames, 'frames').map((f) => ({ pts: Number(f['pts']), type: String(f['pict_type']), key: f['key_frame'] === 1 })),
  };
}

/**
 * What is wrong with a fixture as ffprobe read it, or nothing: its size and time base, a frame every 512 ticks from
 * 0, its samples stored in the order its recipe says, its key frames where the interval puts them and nowhere else,
 * and each frame's type (I at a key frame; with two B-frames, P at every third frame and B at the two between).
 */
export function fixtureProblems(r: Recipe, p: Probe): string[] {
  const out: string[] = [];
  if (p.timeBase !== `1/${TIMESCALE}`) out.push(`time base ${p.timeBase}, not 1/${TIMESCALE}`);
  if (p.width !== r.width || p.height !== r.height) out.push(`${p.width} × ${p.height}, not ${r.width} × ${r.height}`);
  if (p.packets.length !== r.frames || p.frames.length !== r.frames) return [...out, `${p.packets.length} samples and ${p.frames.length} frames, not ${r.frames}`];
  const shown = [...p.frames].sort((a, b) => a.pts - b.pts);
  const first = shown[0]!.pts;
  const off = shown.findIndex((f, k) => f.pts !== first + TICKS * k);
  if (off >= 0) out.push(`frame ${off} is at ${shown[off]!.pts} ticks, not ${TICKS} × ${off} after frame 0's ${first}`);
  // A packet's time against the earliest packet's: frame numbers whether or not the reader shifts times by the edit list.
  const start = Math.min(...p.packets.map((x) => x.pts));
  const stored = p.packets.map((x) => (x.pts - start) / TICKS);
  const want = storedOrder(r);
  const moved = stored.findIndex((k, i) => k !== want[i]);
  if (moved >= 0) out.push(`stored sample ${moved} holds frame ${stored[moved]}, not frame ${want[moved]} (stored order ${stored.slice(0, 10).join(', ')}, …)`);
  const keys = keyFrames(r);
  const storedKeys = p.packets.flatMap((x, i) => (x.key ? [stored[i]!] : [])).sort((a, b) => a - b);
  if (storedKeys.join(',') !== keys.join(',')) out.push(`${storedKeys.length} key frames (${storedKeys.slice(0, 8).join(', ')}${storedKeys.length > 8 ? ', …' : ''}), not ${keys.length} (${keys.slice(0, 8).join(', ')}${keys.length > 8 ? ', …' : ''})`);
  const typeOf = (k: number): string => (keys.includes(k) ? 'I' : r.bframes === 2 && k % 3 !== 0 ? 'B' : 'P');
  const wrong = shown.findIndex((f, k) => f.type !== typeOf(k));
  if (wrong >= 0) out.push(`frame ${wrong} is a ${shown[wrong]!.type}-frame, not a ${typeOf(wrong)}-frame`);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Seeded times (criterion 2)

/** A seeded generator in [0, 1) (mulberry32, as #499's suite seeds its times), the same on every run. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The seeds of criterion 2's times and of the order they are jumped to in. */
export const SEEDS = { times: 3_467_001, order: 3_467_002 } as const;

/**
 * `n` seeded times in the recording's span, whole flicks, each with the frame whose interval holds it, in a seeded
 * order: the times are drawn with one seed, sorted, and shuffled with the other, so the order moves back as often as
 * forward. No two times are equal.
 */
export function seededJumps(r: Recipe, n: number, seeds: { times: number; order: number } = SEEDS): { t: number; frame: number }[] {
  const draw = seeded(seeds.times);
  const span = r.frames * FRAME_FLICKS;
  const times = new Set<number>();
  while (times.size < n) times.add(Math.floor(draw() * span));
  const list = [...times].sort((a, b) => a - b);
  const pick = seeded(seeds.order);
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(pick() * (i + 1));
    [list[i], list[j]] = [list[j]!, list[i]!];
  }
  return list.map((t) => ({ t, frame: frameAt(r, t) }));
}
