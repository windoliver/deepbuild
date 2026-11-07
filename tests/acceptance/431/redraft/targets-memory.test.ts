// #431.a1c2e028, blind redraft (README in this folder): targets cost only when read. A figure whose effects and
// operators read neither velocity nor emission allocates neither, by the meter's GPU memory count, which matches the
// device's sizes; reading both at 1920 × 1080 adds 8,294,400 B and 16,588,800 B; and a planted core that builds both
// for every frame adds 24,883,200 B to the first figure and fails, naming the targets.
//
// Four figures differ only in the core targets one pass operator's inputs `a` and `b` read: color and color (the
// first figure), velocity and color, color and emission, velocity and emission. Each also has a moving box and an
// emissive one, so both targets would have content. Each runs live for 12 frames at 1920 × 1080 in its own
// `deep-gpu run` process with #379's memory report. A target's cost is the writer's count over the first figure's;
// the device's is Metal's allocated size over the call's start, compared the same way. On Metal an allocation's size
// is what the device reports for it (`allocatedSize`), rounded up for the GPU's layout and pages, so a target costs
// at least its texels × bytes (the issue's numbers) and at most 1 MiB more, and the device moves with the count within
// 1 MiB. Off macOS: INCONCLUSIVE.
import { describe, expect, it } from 'vitest';
import {
  MIB, arr, inconclusive, liveReply, obj, requireMetal, start, useBuilds, useOut, type JsonObject,
} from '../../379/helpers.ts';
import { asItem, box, checkCall, checked, figure, liveCall, pass, payload, writeJson } from '../../429/helpers.ts';

const builds = useBuilds(['default']);
const out = useOut();

const ID = '#431.a1c2e028';
/** The wrong program the criterion names, as the original suite names it: a core that builds both targets for every frame. */
const PLANTED = 'builds_unread_targets';
const SIZE: [number, number] = [1920, 1080];
const FRAMES = 12;
const WRITER = 'agent:alpha';
const SESSION = 's';

/** The issue's sizes at 1920 × 1080: velocity 4 B a pixel (rg16float), emission 8 B (rgba16float), and both. */
const VELOCITY_BYTES = 8_294_400;
const EMISSION_BYTES = 16_588_800;
const BOTH_BYTES = 24_883_200;
/** What the device may add to one target's texels × bytes: tile and page rounding, compression metadata. */
const PADDING = MIB;
/** How far Metal's allocated size may move from the count's change per target (#379's tolerance for a count on the device). */
const DEVICE_TOLERANCE = MIB;

type Read = 'color' | 'velocity' | 'emission';
type Name = 'neither' | 'velocity' | 'emission' | 'both';
const FIGURES: { name: Name; a: Read; b: Read }[] = [
  { name: 'neither', a: 'color', b: 'color' },
  { name: 'velocity', a: 'velocity', b: 'color' },
  { name: 'emission', a: 'color', b: 'emission' },
  { name: 'both', a: 'velocity', b: 'emission' },
];
/** Each target, the figure that reads it alone (or both), what the issue says it adds, and how many targets that is. */
const TARGETS: { label: string; figure: Name; bytes: number; targets: number }[] = [
  { label: 'velocity', figure: 'velocity', bytes: VELOCITY_BYTES, targets: 1 },
  { label: 'emission', figure: 'emission', bytes: EMISSION_BYTES, targets: 1 },
  { label: 'velocity and emission', figure: 'both', bytes: BOTH_BYTES, targets: 2 },
];

const fmt = (n: number): string => n.toLocaleString('en-US');
const coreTarget = (output: Read): JsonObject => ({ type: 'texture', from: { texture: { target: { op: 'core', output } } } });

/** The figure's effect: a pass over the frame's color that adds a thousandth of what its inputs `a` and `b` read. */
function reader(a: Read, b: Read, nsPerPx: number): JsonObject {
  return pass('reader', {
    uv: { op: 'screen_uv@1', args: {} },
    c: { op: 'sample@1', args: { tex: 'src', uv: 'uv', lod: 0 } },
    x: { op: 'sample@1', args: { tex: 'a', uv: 'uv', lod: 0 } },
    y: { op: 'sample@1', args: { tex: 'b', uv: 'uv', lod: 0 } },
    s: { op: 'add@1', args: { a: 'x', b: 'y' } },
    k: { op: 'const@1', args: { value: [0.001, 0.001, 0.001, 0], type: 'vec4' } },
    m: { op: 'mul@1', args: { a: 's', b: 'k' } },
    out: { op: 'add@1', args: { a: 'c', b: 'm' } },
  }, {
    about: 'The #431 fixture: a pass over the frame\'s color that adds a thousandth of the two core targets it reads.',
    inputs: { src: coreTarget('color'), a: coreTarget(a), b: coreTarget(b) },
    resolution: 'half',
    cost: { ns_per_px: nsPerPx },
  });
}

/** The figure's material operator: box b2 emits a linear [4, 0, 0] over a dark base color, and reads no target. */
function emitter(nsPerPx: number): JsonObject {
  return {
    id: 'emitter', kind: 'material', origin: 'composed', about: 'The #431 fixture: emits a linear [4, 0, 0] over a dark base color.', inputs: {},
    steps: {
      e: { op: 'const@1', args: { value: [4, 0, 0], type: 'vec3' } },
      k: { op: 'const@1', args: { value: [0.05, 0.05, 0.05], type: 'vec3' } },
    },
    outputs: { emission: 'e', base_color: 'k' },
    cost: { ns_per_px: nsPerPx },
  };
}

/** `deep-gpu run [--planted <name>]` on one scenario, accepted, with one reply per call. */
function scenario(bin: string, dir: string, calls: JsonObject[], planted?: typeof PLANTED): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const shown = `deep-gpu ${args.join(' ')}`;
  const s = start(bin, args, [{ out: dir, calls }], 1_800_000);
  expect(s.timedOut, `${shown} finished within its timeout`).toBe(false);
  expect(s.status, `${shown} exited 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-3000)}`).toBe(0);
  expect(s.lines.length, `${shown}: one output line per input line`).toBe(1);
  const answer = obj(s.lines[0], `${shown}: the answer`);
  expect(answer['ok'], `${shown} took the scenario: ${JSON.stringify(answer).slice(0, 2000)}`).toBe(true);
  const replies = arr(answer['replies'], `${shown}: replies`).map((r, i) => obj(r, `${shown}: replies[${i}]`));
  expect(replies.length, `${shown}: one reply per call`).toBe(calls.length);
  return replies;
}

/**
 * Each operator's declared cost: 1.1 × the check's estimate (`check_operator`'s `estimate_ns`), the largest of the
 * four readers' for the reader, so every figure declares the same cost, the check never finds it understated, and
 * the figure's budget class holds it at 1920 × 1080. Every reader, the velocity and emission ones among them, checks.
 */
function declaredCosts(bin: string, dir: string): { reader: number; emitter: number } {
  const ops = [...FIGURES.map((f) => reader(f.a, f.b, 1000)), emitter(1000)];
  const estimates = scenario(bin, dir, ops.map(checkCall)).map((r, i) => {
    const what = i < FIGURES.length ? `the ${FIGURES[i]!.name} figure's reader` : 'the emitter material';
    const c = checked(r, `check_operator on ${what}`);
    expect(c.outcome, `${what} checks: ${JSON.stringify(c.raw).slice(0, 1500)}`).toBe('accepted');
    expect(c.estimate, `${what}: the check gives its estimate, estimate_ns`).not.toBeNull();
    return c.estimate!;
  });
  const declared = (e: number): number => Math.max(1.1 * e, 0.01);
  return { reader: declared(Math.max(...estimates.slice(0, FIGURES.length))), emitter: declared(estimates[FIGURES.length]!) };
}

/** The four figures as writer payloads (#393's), class figure, 1920 × 1080, box b0 moving and box b2 emissive. */
function writeFigures(dir: string, cost: { reader: number; emitter: number }): Record<Name, string> {
  const paths = {} as Record<Name, string>;
  for (const f of FIGURES) {
    const doc = figure(`targets-431-${f.name}`, {
      b2: box([2, 0, 0], { material: 'emitm' }),
      emitter: asItem(emitter(cost.emitter)),
      emitm: { kind: 'material@1', params: { op: 'emitter' } },
      reader: asItem(reader(f.a, f.b, cost.reader)),
    }, { moving: true, cls: 'figure', size: SIZE });
    paths[f.name] = writeJson(dir, `${f.name}.json`, payload(doc));
  }
  return paths;
}

interface Reading { count: number; device: number }
type Readings = Record<Name, Reading>;

/**
 * Each figure live for 12 frames at 1920 × 1080 in its own process (nothing left over from another figure): the
 * writer's meter count at frame 12 and Metal's allocated size then, less its value before the call opened anything.
 */
function measure(bin: string, dir: string, paths: Record<Name, string>, planted?: typeof PLANTED): Readings {
  const readings = {} as Readings;
  for (const f of FIGURES) {
    const what = `the ${f.name} figure${planted ? ` under --planted ${planted}` : ''}`;
    const [reply] = scenario(bin, dir, [liveCall({
      frames: FRAMES, sessions: [{ session: SESSION, writer: WRITER, doc: paths[f.name], size: SIZE }], report: ['memory'],
    })], planted);
    const live = liveReply(reply!, `${what}: the live call`);
    const row = live.sessions.find((s) => s.session === SESSION);
    expect(row?.state, `${what} is live at 1920 × 1080, not refused: ${JSON.stringify(row?.issues ?? []).slice(0, 1500)}`).toBe('live');
    expect(live.frames.some((x) => x.views.some((v) => v.session === SESSION && v.drawn)), `${what} draws`).toBe(true);
    const last = live.frames.find((x) => x.frame === FRAMES);
    expect(last, `${what}: frame ${FRAMES} is reported`).toBeDefined();
    const frame = last!;
    const view = frame.views.find((v) => v.session === SESSION);
    expect(view?.internal_scale, `${what} draws at internal scale 1 (a figure's render scale while moving), so the core's targets are 1920 × 1080`).toBe(1);
    const held = (frame.writers ?? []).find((w) => w.writer === WRITER);
    expect(held, `${what}: frame ${FRAMES}'s memory report holds ${WRITER}'s count`).toBeDefined();
    const before = live.device_before;
    const after = frame.device_bytes;
    if (typeof after !== 'number' || before === null) inconclusive(`${what}: Metal's allocated size isn't reported (device_before ${before}, device_bytes ${after})`);
    readings[f.name] = { count: held!.count_bytes, device: after - before };
  }
  console.log(`${planted ?? 'shipped'}: ${FIGURES.map((f) => `${f.name} count ${fmt(readings[f.name].count)} B, device +${fmt(readings[f.name].device)} B`).join('; ')}`);
  return readings;
}

/** The criterion's check on one program's readings: one sentence per failure, each starting with the target(s) it names. */
function problems(r: Readings): string[] {
  const found: string[] = [];
  for (const t of TARGETS) {
    const count = r[t.figure].count - r.neither.count;
    const device = r[t.figure].device - r.neither.device;
    const most = t.bytes + t.targets * PADDING;
    if (count < t.bytes) {
      found.push(`${t.label}: the figure reading ${t.label} counts ${fmt(count)} B more than the figure reading neither, not the ${fmt(t.bytes)} B the issue gives at 1920 × 1080${count < PADDING ? `; the figure reading neither already holds ${t.label === 'velocity and emission' ? 'them' : 'it'}` : ''}`);
    } else if (count > most) {
      found.push(`${t.label}: the figure reading ${t.label} counts ${fmt(count)} B more than the figure reading neither, more than the ${fmt(t.bytes)} B the issue gives plus the device's padding (${fmt(most)} B at most)`);
    }
    if (Math.abs(device - count) > t.targets * DEVICE_TOLERANCE) {
      found.push(`${t.label}: reading ${t.label} moves the meter's count by ${fmt(count)} B but Metal's allocated size by ${fmt(device)} B, more than ${t.targets} MiB apart`);
    }
  }
  return found;
}

describe(`${ID} targets cost only when read (redraft)`, () => {
  it(`${ID} a figure whose effects and operators read neither velocity nor emission allocates neither, by the meter's count, which moves with Metal's allocated size; reading velocity adds 8,294,400 B, emission 16,588,800 B and both 24,883,200 B at 1920 × 1080, each at the device's sizes`, () => {
    requireMetal();
    const dir = out();
    const paths = writeFigures(dir, declaredCosts(builds.bin(), dir));
    const found = problems(measure(builds.bin(), dir, paths));
    expect(found, 'each target is counted, at the device\'s size, only in a figure that reads it').toEqual([]);
  }, 1_800_000);

  it(`${ID} planted ${PLANTED}: a core that builds velocity and emission for every frame adds 24,883,200 B to the figure that reads neither and fails, naming the targets`, () => {
    requireMetal();
    const dir = out();
    const paths = writeFigures(dir, declaredCosts(builds.bin(), dir));
    const shipped = measure(builds.bin(), dir, paths);
    const planted = measure(builds.bin(), dir, paths, PLANTED);
    const added = planted.neither.count - shipped.neither.count;
    expect(added, `the planted core adds at least 24,883,200 B to the figure that reads neither (it adds ${fmt(added)} B)`).toBeGreaterThanOrEqual(BOTH_BYTES);
    expect(added, `and no more than the device's padding over it (it adds ${fmt(added)} B)`).toBeLessThanOrEqual(BOTH_BYTES + 2 * PADDING);
    const found = problems(planted);
    console.log(`${PLANTED}: ${found.join(' | ')}`);
    expect(found.some((p) => p.startsWith('velocity:')), `the check fails the planted core naming velocity: ${found.join(' | ')}`).toBe(true);
    expect(found.some((p) => p.startsWith('emission:')), `the check fails the planted core naming emission: ${found.join(' | ')}`).toBe(true);
  }, 3_600_000);
});
