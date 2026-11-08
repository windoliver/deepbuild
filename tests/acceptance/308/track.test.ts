// AC3-AC7, AC9 and AC10 #308: the controls and the input track's handling, through `deep-canvas input`
// (README: `input`), and the parameter tool's stamp at the seal.
//
// AC3 "A dragged point never leaves its path, and one drag is one change"
// AC4 "A three-option choice with no default reads −1 in a driver before any entry and 2 after its third option is
//   picked, and one whose default is its second option reads 1 before any entry"
// AC5 "A press control with keys and no binds appends exactly one entry per press, whether you or a tour pressed it,
//   and none while a key is held down, and a driver that counts its entries reads the same count by seeking as by playing"
// AC6 "A session of 30 slider entries, one every 2 s from 1 s, scrubbed back and forth across its span 50 times keeps
//   all 30 entries and the track's hash, and playing on from any point gives the recorded values at their flicks; a
//   drag while paused at 20 s after a seek back forks the track there: the 20 entries after 20 s are gone, fork_at
//   reads 20 s and the hash changes; and a planted transport that forks on a scrub alone loses entries on the first
//   scrub and fails; with a follow channel on a slider with 12 recorded entries, one slider drag after a seek back to
//   5 s forks the track at the drag's flick, drops the entries after it and rebuilds only the segments from the fork
//   on, while a planted transport that forks on a scrub alone changes the track's hash on the first scrub and fails"
// AC7 "The parameter tool sets a slider as one entry stamped with the agent as its writer, which a replay reads as
//   recorded; a planted tool that stamps its entry as you fails the kit's input part at the seal, naming the control"
// AC9 "A tour with idle_after 1.4 s writes its first entry 1.4 s after your last gesture, writes none from the flick
//   of your drag at 5 s, resumes 3.6 s after that gesture ends, writes none under reduced motion, and replays to the
//   same input-track hash; a planted tour that writes during your drag fails, naming the entry"
// AC10 "A hover control over a card with smoothing: follow transition {span: 0.3 s, interp: ease out_cubic}, whose
//   value lifts the card 10 u …: in a replica whose pointer enters at 1.0 s and leaves at 2.0 s, the lift reads 8.75 u
//   at 1.15 s, 10 u from 1.3 s, 1.25 u at 2.15 s and 0 from 2.3 s; a pointer that leaves at 1.1 s starts the fall from
//   7.037 u (10 × 19/27); the golden and an export draw the card at rest; and a planted smoothing that starts the fall
//   from 10 u jumps at 1.1 s and fails, naming the card"
import { describe, expect, it } from 'vitest';
import {
  BEAD, CARD, FPS, GAIN, KNOB, KNOB2, NEEDLE, OTHER, RAIL_CONTROL, TRANSITION_03_OUT_CUBIC, advance, canon, doc, down, failsNaming, fl, hoverControl, inputPlanted,
  inputRun, inputRuns, key, move, near, none, outCubic, px, railAt, railDistance, read, readChannel, refusalFailures, rectItem, seeded, seek, setControl, shuffled,
  startup, tool, up, useBuilds, useCanvas, valueOf, type Build, type InputLine, type JsonObject, type Op, type Ran,
} from './helpers.ts';

const canvas = useCanvas();
const FULL: Build = { set: 'full' };
const builds = useBuilds([FULL]);
const line = (d: JsonDoc, ops: Op[], extra: Partial<InputLine> = {}): InputLine => ({ doc: d, viewport: [640, 360], ops, ...extra });
type JsonDoc = ReturnType<typeof doc>;

/** Ops built in time order, remembering the index whose result a test reads. */
class Script {
  ops: Op[] = [];
  add(...o: Op[]): number { const i = this.ops.length; this.ops.push(...o); return i; }
  /** Play to `t`, then read `control` there; the index of the read. */
  at(t: number, control: string, mode?: 'live' | 'golden' | 'export'): number { this.ops.push(advance(t), read(control, t, mode)); return this.ops.length - 1; }
}

// ---------------------------------------------------------------------------------------------------- AC3

describe('AC3 #308 a dragged point stays on its path, and one drag is one change', () => {
  const D = doc('rail', [BEAD], { rail: RAIL_CONTROL });
  it('AC3 the pointer wanders off the rail, past both ends and around its corner: every resolved sample is on the path, the handle sits at the path\'s point for its value, and each drag appends one entry', () => {
    const wander = (t0: number): Op[] => [
      down(100, 100, t0), move(130, 60, t0 + 0.05), move(200, 100, t0 + 0.1), move(250, 300, t0 + 0.15), move(400, 150, t0 + 0.2),
      move(350, 220, t0 + 0.25), move(310, 90, t0 + 0.3), move(60, 40, t0 + 0.35), move(120, 400, t0 + 0.4), up(120, 400, t0 + 0.45),
    ];
    const r = inputRun(canvas.bin(), line(D, [...wander(1), ...wander(3)]));
    const failures: string[] = [];
    const rail = r.track.filter((e) => e.control === 'rail');
    if (rail.length !== 2) failures.push(`two drags of the control rail leave ${rail.length} entries on the track, not 2 (one drag is one change)`);
    for (const [i, e] of rail.entries()) {
      if (!e.samples || e.samples.length < 8) failures.push(`rail entry ${i} carries ${e.samples?.length ?? 0} samples, not its drag's polyline`);
      for (const s of e.samples ?? []) {
        const v = typeof s.value === 'number' ? s.value : NaN;
        if (!(v >= 0 && v <= 1)) { failures.push(`rail entry ${i}: sample at ${s.t} reads ${String(s.value)}, outside 0..1`); continue; }
        if (!s.at) { failures.push(`rail entry ${i}: sample at ${s.t} has no resolved handle position \`at\``); continue; }
        if (railDistance(s.at[0], s.at[1]) > 1e-6) failures.push(`rail entry ${i}: the handle leaves its path at sample ${s.t}: [${s.at}] is ${railDistance(s.at[0], s.at[1])} u off`);
        const [x, y] = railAt(v);
        if (Math.hypot(s.at[0] - x, s.at[1] - y) > 1e-6) failures.push(`rail entry ${i}: sample ${s.t} puts the handle at [${s.at}], not the path's point [${x}, ${y}] for its value ${v}`);
      }
      if (typeof e.value !== 'number' || !near(e.value, typeof e.samples?.[e.samples.length - 1]?.value === 'number' ? (e.samples![e.samples!.length - 1]!.value as number) : NaN)) failures.push(`rail entry ${i}: its value ${String(e.value)} is not its last sample's`);
    }
    none(failures, 'the dragged point');
    expect(r.results.slice(0, 10).every((x) => typeof x.value === 'number' && (x.value as number) >= 0 && (x.value as number) <= 1), 'every value reported while dragging is on the path (0..1)').toBe(true);
  }, 1_800_000);
});

// ---------------------------------------------------------------------------------------------------- AC4

describe('AC4 #308 a choice reads as its option\'s index', () => {
  const quiz = (extra: JsonObject = {}): JsonObject => ({ kind: 'choice', class: 'document', label: 'Answer', role: 'radiogroup', options: ['a', 'b', 'c'], ...extra });
  const D = doc('choice', [rectItem('ca', 'Option A', 'a1', 100, 100, 60, 40), rectItem('cb', 'Option B', 'a2', 200, 100, 60, 40), rectItem('cc', 'Option C', 'a3', 300, 100, 60, 40)], {
    quiz: quiz({ verb: 'pick', targets: { a: 'ca', b: 'cb', c: 'cc' } }),
    second: quiz({ default: 'b' }),
  });
  it('AC4 a three-option choice with no default reads -1 before any entry and 2 after its third option is picked; one whose default is its second option reads 1 before any entry', () => {
    const s = new Script();
    const before = [s.at(0.5, 'quiz'), s.at(0.5, 'second')];
    s.add(down(330, 120, 1.0), up(330, 120, 1.05)); // a click on the third option's target
    const after = [s.at(1.1, 'quiz'), s.at(1.1, 'second')];
    s.add(seek(0.5));
    const back = s.ops.length; s.add(read('quiz', 0.5), read('second', 0.5));
    const r = inputRun(canvas.bin(), line(D, s.ops));
    const got = [...before, ...after, back, back + 1].map((i) => valueOf(r.results[i]!, `read ${i}`));
    expect(got, 'quiz reads -1 and second 1 before any entry; after the click on the third option, quiz reads 2 and second still 1; seeking back to before the click reads -1 again').toEqual([-1, 1, 2, 1, -1, 1]);
    expect(r.track.filter((e) => e.control === 'quiz').length, 'the click is one entry').toBe(1);
  }, 1_800_000);
});

// ---------------------------------------------------------------------------------------------------- AC5

describe('AC5 #308 a press control appends one entry per press', () => {
  const D = doc('press', [KNOB], {
    fire: { kind: 'press', class: 'document', label: 'Fire', role: 'button', keys: { Enter: 1 } },
  }, { tour: { keys: { fire: [[0, 1, 'hold'], [0.5, 1, 'hold']] }, idle_after: 1.4, resume_after: 3.6, loop: false } });
  const CHECKS: [number, number][] = [[0.5, 0], [1.2, 1], [2.5, 1], [3.5, 2], [4.5, 3], [7.0, 5]];
  const gestures = (s: Script): void => {
    s.at(0.5, 'fire'); s.add(key('fire', 'Enter', 1.0)); s.at(1.2, 'fire');
    s.add(key('fire', 'Enter', 1.5, [], { repeat: true }), key('fire', 'Enter', 2.0, [], { repeat: true }), key('fire', 'Enter', 2.2, [], { phase: 'up' }));
    s.at(2.5, 'fire'); s.add(key('fire', 'Enter', 3.0), key('fire', 'Enter', 3.1, [], { phase: 'up' })); s.at(3.5, 'fire');
    s.add(key('fire', 'Enter', 4.0), key('fire', 'Enter', 4.05, [], { phase: 'up' })); s.at(4.5, 'fire'); s.at(7.0, 'fire');
  };
  it('AC5 three presses of yours (one held with key repeat) and two of the tour append exactly five entries, and a driver counting them reads the same by seeking as by playing', () => {
    const play = new Script(); gestures(play);
    const seeker = new Script(); gestures(seeker);
    const first = seeker.ops.length;
    seeker.add(advance(8));
    for (const [t] of shuffled(CHECKS, 308)) seeker.add(seek(t), read('fire', t));
    const [p, sk] = inputRuns(canvas.bin(), [line(D, play.ops), line(D, seeker.ops)]);
    const readIdx = play.ops.flatMap((o, i) => (o['op'] === 'read' ? [i] : []));
    const played = readIdx.map((i) => p!.results[i]!.count);
    expect(played, 'playing, the driver counts 0, 1, 1, 2, 3 and 5 entries at 0.5, 1.2, 2.5, 3.5, 4.5 and 7 s (key repeat while held adds none)').toEqual(CHECKS.map(([, c]) => c));
    const sought = new Map<number, number | undefined>();
    for (let i = first + 1; i < seeker.ops.length; i += 2) sought.set(Math.round((seeker.ops[i + 1]!['t'] as number) / 705_600_000 * 1000) / 1000, sk!.results[i + 1]!.count);
    expect([...CHECKS].map(([t]) => sought.get(t)), 'seeking to the same times in another order, it counts the same').toEqual(CHECKS.map(([, c]) => c));
    const writers = p!.track.filter((e) => e.control === 'fire').map((e) => e.writer).sort();
    expect(writers, 'the track holds three entries of yours and two of the tour').toEqual(['tour', 'tour', 'you', 'you', 'you']);
    expect(p!.track.filter((e) => e.writer === 'tour').every((e) => e.serial === undefined), 'a tour\'s press carries no gesture serial: it never counts as yours').toBe(true);
  }, 1_800_000);
});

// ---------------------------------------------------------------------------------------------------- AC6

describe('AC6 #308 seek versus edit', () => {
  const D = doc('track', [KNOB], { gain: GAIN });
  const rand = seeded(30_308);
  const VALUES = Array.from({ length: 30 }, () => Math.round(rand() * 1000) / 1000);
  const T = (i: number): number => 1 + 2 * i; // 1, 3, ... 59 s
  const record = (): Op[] => VALUES.map((v, i) => setControl('gain', v, T(i)));
  const expected = (t: number): number => { let v = 0.5; VALUES.forEach((x, i) => { if (fl(T(i)) <= fl(t)) v = x; }); return v; };

  function scrubPasses(): { ops: Op[]; at: number[] } {
    const r = seeded(50_308);
    const ops: Op[] = []; const at: number[] = [];
    for (let pass = 0; pass < 50; pass++) {
      const times = Array.from({ length: 6 }, (_, i) => Math.round(((i + r()) / 6) * 60 * 1000) / 1000);
      if (pass % 2 === 1) times.reverse();
      for (const t of times) { ops.push(seek(t)); at.push(ops.length); ops.push(read('gain', t)); }
    }
    return { ops, at };
  }
  const SCRUB = scrubPasses();

  /** The scrubbed session keeps its 30 entries and the recorded hash, reads the recorded values, and never forks. Failures name the control. */
  function scrubFailures(scrubbed: Ran | null, recorded: Ran, what: string): string[] {
    if (!scrubbed) return [`${what}: no answer for the control gain`];
    const failures: string[] = [];
    if (scrubbed.track.length !== 30) failures.push(`${what}: the track of the control gain holds ${scrubbed.track.length} entries after the scrub, not 30`);
    if (scrubbed.hash !== recorded.hash) failures.push(`${what}: the track's hash changed from ${recorded.hash} to ${scrubbed.hash} on a scrub alone (control gain)`);
    if (canon(scrubbed.track.map((e) => e.raw)) !== canon(recorded.track.map((e) => e.raw))) failures.push(`${what}: the entries of the control gain changed on a scrub alone`);
    if (scrubbed.fork_at !== null) failures.push(`${what}: a scrub alone set fork_at to ${scrubbed.fork_at} (control gain)`);
    // Dropped entries on the first scrub show in the result of the first seek.
    const firstScrub = scrubbed.results[record().length]!;
    if (firstScrub.dropped !== 0) failures.push(`${what}: the first scrub dropped ${firstScrub.dropped} entries of the control gain`);
    SCRUB.at.forEach((i, k) => {
      const want = expected(Number((SCRUB.ops[i]!['t'] as number) / 705_600_000));
      const got = scrubbed.results[i + record().length]!.value;
      if (got !== want) failures.push(`${what}: scrub ${k} reads ${String(got)} for gain, the recorded value is ${want}`);
    });
    return failures;
  }

  it('AC6 30 slider entries scrubbed back and forth 50 times keep all 30 entries and the hash, read the recorded values and play on to them; a planted transport that forks on a scrub alone loses entries on the first scrub', () => {
    const bin = canvas.bin();
    const playOps: Op[] = record(); const reads: { idx: number; from: number; t: number; v: number }[] = [];
    for (const from of [0.5, 20.5, 33.2]) {
      playOps.push(seek(from));
      VALUES.forEach((v, i) => { if (T(i) > from) { playOps.push(advance(T(i)), read('gain', T(i))); reads.push({ idx: playOps.length - 1, from, t: T(i), v }); } });
    }
    const [recorded, scrubbed, played] = inputRuns(bin, [line(D, record()), line(D, [...record(), ...SCRUB.ops]), line(D, playOps)]);
    expect(recorded!.track.length, 'the recorded session holds its 30 entries').toBe(30);
    expect(recorded!.track.map((e) => e.t), 'one entry every 2 s from 1 s').toEqual(VALUES.map((_, i) => fl(T(i))));
    none(scrubFailures(scrubbed!, recorded!, 'the scrub'), 'the scrub');
    // Playing on from any point gives the recorded values at their flicks.
    none(reads.flatMap((x) => (played!.results[x.idx]!.value === x.v ? [] : [`playing on from ${x.from} s, the read at ${x.t} s is ${String(played!.results[x.idx]!.value)}, not the recorded ${x.v}`])), 'playing on');
    expect(reads.length, 'the play-on reads were checked').toBeGreaterThan(40);
    expect(played!.hash, 'playing on from any point leaves the hash').toBe(recorded!.hash);
    const planted = inputPlanted(bin, line(D, [...record(), ...SCRUB.ops], { planted: 'transport_forks_on_scrub' }));
    failsNaming(scrubFailures(planted, recorded!, 'the planted transport'), ['gain', 'first scrub'], 'the planted transport that forks on a scrub alone');
  }, 1_800_000);

  it('AC6 a drag while paused at 20 s after a seek back forks the track there: the 20 entries after 20 s are gone, fork_at reads 20 s and the hash changes', () => {
    const v19 = VALUES[9]!; // the value at 20 s: the entry at 19 s
    const [recorded, forked] = inputRuns(canvas.bin(), [
      line(D, record()),
      line(D, [...record(), seek(20), down(px(v19), 180, 20), move(px(v19) + 30, 180, 20), up(px(v19) + 30, 180, 20)]),
    ]);
    const f = forked!;
    expect(f.track.length, '10 entries up to 20 s and the drag\'s one').toBe(11);
    expect(f.track.filter((e) => e.t > fl(20)).length, 'the 20 entries after 20 s are gone').toBe(0);
    expect(f.results.reduce((n, r) => n + r.dropped, 0), 'the fork dropped 20 entries').toBe(20);
    expect(f.fork_at, 'fork_at reads 20 s').toBe(fl(20));
    expect(f.hash, 'the hash changes').not.toBe(recorded!.hash);
    expect(canon(f.track.slice(0, 10).map((e) => e.raw)), 'the ten earlier entries are kept as recorded').toBe(canon(recorded!.track.slice(0, 10).map((e) => e.raw)));
    expect(f.track[10]!.writer, 'the drag is yours').toBe('you');
  }, 1_800_000);

  it('AC6 with a follow channel on a slider with 12 recorded entries, one drag after a seek back to 5 s forks at the drag\'s flick, drops the entries after it and rebuilds only the segments from the fork on', () => {
    const FD = doc('follow', [KNOB, NEEDLE], { gain: GAIN }, {
      channels: { dial: { target: 'items/needle/at/pos/0', type: 'f32', mode: 'follow', follow: { source: 'controls/gain/value', model: { spring: { freq_hz: 1.5, damping_ratio: 0.4 } } } } },
    });
    const vals = VALUES.slice(0, 12);
    const rec = vals.map((v, i) => setControl('gain', v, 1.5 + i)); // 1.5 .. 12.5 s
    const v45 = vals[3]!; // the value at 5 s: the entry at 4.5 s
    const s = new Script();
    s.add(...rec, advance(13));
    const full = s.add(readChannel('dial', 13));
    s.add(seek(5));
    const back = s.add(readChannel('dial', 5));
    s.add(down(px(v45), 180, 5), move(px(v45) + 30, 180, 5), up(px(v45) + 30, 180, 5), advance(13));
    const after = s.add(readChannel('dial', 13));
    const r = inputRun(canvas.bin(), line(FD, s.ops));
    const solves = (i: number): number => { const x = r.results[i]!.raw['solves']; expect(typeof x, `the read ${i} of the channel dial reports its solves`).toBe('number'); return x as number; };
    expect(solves(full), 'the straight play solved some segments').toBeGreaterThan(0);
    expect(solves(back), 'a seek back solves nothing again').toBe(solves(full));
    expect(r.fork_at, 'the drag forks the track at its flick, 5 s').toBe(fl(5));
    expect(r.track.length, 'the four entries up to 5 s and the drag\'s').toBe(5);
    expect(r.results.reduce((n, x) => n + x.dropped, 0), 'the eight entries after 5 s are dropped').toBe(8);
    const rebuilt = solves(after) - solves(full);
    expect(rebuilt >= 1 && rebuilt <= 3, `only the segments from the fork on are rebuilt: ${rebuilt} solves after the fork, against ${solves(full)} for the whole play`).toBe(true);
  }, 1_800_000);
});

// ---------------------------------------------------------------------------------------------------- AC7

describe('AC7 #308 the parameter tool is stamped as the agent', () => {
  const D = doc('tool', [KNOB], { gain: GAIN });
  const ops = (): Op[] => [down(200, 180, 1.0), move(230, 180, 1.1), up(230, 180, 1.2), tool('gain', 0.8, 2.0), advance(3), read('gain', 3)];
  function toolFailures(runs: (Ran | null)[], what: string): string[] {
    const failures: string[] = [];
    runs.forEach((r, i) => {
      if (!r) { failures.push(`${what}: no answer at ${FPS[i]![0]} fps for the control gain`); return; }
      const mine = r.track.filter((e) => e.writer === 'you');
      const agent = r.track.filter((e) => e.t === fl(2.0));
      if (agent.length !== 1) { failures.push(`${what}: the tool leaves ${agent.length} entries at 2 s for the control gain, not 1`); return; }
      if (agent[0]!.writer !== 'agent') failures.push(`${what}: the tool's entry for the control gain is stamped ${agent[0]!.writer}, not agent`);
      if (agent[0]!.serial !== undefined) failures.push(`${what}: the tool's entry for the control gain carries a gesture serial`);
      if (mine.length !== 1 || mine[0]!.t !== fl(1.0)) failures.push(`${what}: your own entry for the control gain is not left as it was: ${JSON.stringify(r.track.map((e) => [e.t, e.writer]))}`);
      if (valueOf(r.results[5]!, 'the read') !== 0.8) failures.push(`${what}: the replay reads ${String(r.results[5]!.value)} for gain at 3 s, not the recorded 0.8`);
    });
    if (runs.every((r) => r) && new Set(runs.map((r) => r!.hash)).size !== 1) failures.push(`${what}: the hash differs across 30, 60 and 120 fps`);
    return failures;
  }
  it('AC7 the tool sets a slider as one entry stamped agent, which a replay reads as recorded and which leaves your entries as they were; a planted tool that stamps its entry as you fails, naming the control, and the seal refuses it at the input part', () => {
    const bin = canvas.bin();
    none(toolFailures(inputRuns(bin, FPS.map((fps) => line(D, ops(), { fps }))), 'the tool'), 'the parameter tool');
    failsNaming(toolFailures(FPS.map((fps) => inputPlanted(bin, line(D, ops(), { fps, planted: 'tool_stamps_you' }))), 'the planted tool'), ['gain', 'you'], 'the planted tool that stamps its entry as you');
    none(refusalFailures(startup(builds.bin(FULL), 'input_tool_stamps_you'), { reasons: ['entry_refused'], registry: 'control@1', entries: ['slider'], rules: ['input'] }), 'the planted parameter tool at the seal');
  }, 1_800_000);
});

// ---------------------------------------------------------------------------------------------------- AC9

describe('AC9 #308 the tour', () => {
  const D = doc('tour', [KNOB, KNOB2], { gain: GAIN, other: OTHER }, {
    tour: { keys: { gain: [[0, 0.2, 'hold'], [0.5, 0.8, 'hold'], [1.0, 0.4, 'hold']] }, idle_after: 1.4, resume_after: 3.6, loop: true },
  });
  // Your gestures drag the second slider, which the tour never keys: one from 1.0 s to 2.0 s, one from 5.0 s to 5.5 s.
  const ops = (): Op[] => [
    down(200, 260, 1.0), move(230, 260, 1.5), up(230, 260, 2.0), advance(5.0),
    down(227, 260, 5.0), move(247, 260, 5.2), up(247, 260, 5.5), advance(15),
  ];
  function tourFailures(runs: (Ran | null)[], what: string): string[] {
    const failures: string[] = [];
    runs.forEach((r, i) => {
      const at = `${what} at ${FPS[i]![0]} fps`;
      if (!r) { failures.push(`${at}: no answer for the tour`); return; }
      const tour = r.track.filter((e) => e.writer === 'tour').sort((a, b) => a.t - b.t);
      if (tour.length === 0) { failures.push(`${at}: the tour writes no entry`); return; }
      if (tour[0]!.t !== fl(3.4)) failures.push(`${at}: the tour's first entry (${tour[0]!.control} #${tour[0]!.seq}) is at ${tour[0]!.t / 705_600_000} s, not 1.4 s after your last gesture, 3.4 s`);
      for (const e of tour) {
        if (e.t >= fl(5.0) && e.t < fl(9.1)) failures.push(`${at}: the tour writes the entry ${e.control} #${e.seq} at ${e.t / 705_600_000} s, during your drag from 5.0 s or the 3.6 s of quiet after it`);
        if (e.serial !== undefined || e.control !== 'gain') failures.push(`${at}: the tour's entry ${e.control} #${e.seq} counts as your gesture or writes a control it doesn't key`);
      }
      if (!tour.some((e) => e.t >= fl(9.1) && e.t <= fl(10.2))) failures.push(`${at}: the tour does not resume 3.6 s after your gesture ends (9.1 s): its entries are at ${tour.map((e) => e.t / 705_600_000).join(', ')} s`);
    });
    if (runs.every((r) => r) && new Set(runs.map((r) => r!.hash)).size !== 1) failures.push(`${what}: the input-track hash differs across 30, 60 and 120 fps`);
    return failures;
  }
  it('AC9 a tour with idle_after 1.4 s writes its first entry 1.4 s after your last gesture, writes none from your drag at 5 s, resumes 3.6 s after it ends, writes none under reduced motion, and replays to one hash; a planted tour that writes during your drag fails, naming the entry', () => {
    const bin = canvas.bin();
    none(tourFailures(inputRuns(bin, FPS.map((fps) => line(D, ops(), { fps }))), 'the tour'), 'the tour');
    const [reduced] = inputRuns(bin, [line(D, ops(), { reduced_motion: true })]);
    expect(reduced!.track.filter((e) => e.writer === 'tour').length, 'under reduced motion the tour writes nothing').toBe(0);
    expect(reduced!.track.filter((e) => e.writer === 'you').length, 'and your two gestures are still recorded').toBe(2);
    failsNaming(tourFailures(FPS.map((fps) => inputPlanted(bin, line(D, ops(), { fps, planted: 'tour_writes_during_drag' }))), 'the planted tour'), ['gain #', 'during your drag'], 'the planted tour');
  }, 1_800_000);
});

// ---------------------------------------------------------------------------------------------------- AC10

describe('AC10 #308 hover with a fixed-span transition', () => {
  const D = doc('hover', [CARD], { hover: hoverControl(TRANSITION_03_OUT_CUBIC) });
  const IN = [350, 140] as const; const OUT = [50, 50] as const;
  const ms = (x: number): number => Math.round(x * 1000) / 1000;
  const RISE = Array.from({ length: 13 }, (_, i) => ms(1.0 + 0.025 * i)); // 1.0 .. 1.3 s
  /** Enter at 1.0 s, leave at `leave`; the reads' indexes by time. */
  function session(leave: number, readTimes: number[], modes: [number, 'golden' | 'export'][] = []): { line: InputLine; at: Map<number, number>; modes: number[] } {
    const s = new Script(); const at = new Map<number, number>(); const m: number[] = [];
    s.add(move(OUT[0], OUT[1], 0.5), move(IN[0], IN[1], 1.0));
    let left = false;
    for (const t of [...new Set([...readTimes, leave])].sort((a, b) => a - b)) {
      if (t >= leave && !left) { s.add(move(OUT[0], OUT[1], leave)); left = true; }
      if (readTimes.includes(t)) at.set(t, s.at(t, 'hover'));
      for (const [mt, mode] of modes) if (mt === t) { s.add(read('hover', t, mode)); m.push(s.ops.length - 1); }
    }
    return { line: line(D, s.ops), at, modes: m };
  }
  const lift = (r: Ran, i: number): number => valueOf(r.results[i]!, `the lift at read ${i}`);
  const FALL = [1.0, 1.15, 1.3, 1.5, 2.0, 2.15, 2.3, 2.5];

  it('AC10 pointer in at 1.0 s and out at 2.0 s: the lift reads 8.75 u at 1.15 s, 10 u from 1.3 s, 1.25 u at 2.15 s and 0 from 2.3 s, on the out_cubic curve throughout; the golden and an export draw the card at rest', () => {
    const times = [...new Set([...RISE, ...FALL, ...Array.from({ length: 13 }, (_, i) => ms(2.0 + 0.025 * i))])].sort((a, b) => a - b);
    const sess = session(2.0, times, [[1.3, 'golden'], [1.3, 'export']]);
    const r = inputRun(canvas.bin(), sess.line);
    const exact: [number, number][] = [[1.0, 0], [1.15, 8.75], [1.3, 10], [1.5, 10], [2.0, 10], [2.15, 1.25], [2.3, 0], [2.5, 0]];
    const failures: string[] = [];
    for (const [t, want] of exact) { const got = lift(r, sess.at.get(t)!); if (!near(got, want)) failures.push(`the card's lift at ${t} s reads ${got} u, not ${want}`); }
    for (const t of times) {
      const want = t <= 1.0 ? 0 : t < 1.3 ? 10 * outCubic((t - 1.0) / 0.3) : t < 2.0 ? 10 : t < 2.3 ? 10 * (1 - outCubic((t - 2.0) / 0.3)) : 0;
      const got = lift(r, sess.at.get(t)!);
      if (!near(got, want)) failures.push(`the card's lift at ${t} s reads ${got} u, the out_cubic curve gives ${want}`);
    }
    none(failures, 'the card hover');
    expect(sess.modes.map((i) => lift(r, i)), 'the golden and an export read the card at rest (0) where the live view reads 10').toEqual([0, 0]);
  }, 1_800_000);

  it('AC10 a pointer that leaves at 1.1 s starts the fall from 7.037 u (10 × 19/27) and eases to 0 from there; a planted smoothing that starts the fall from 10 u jumps at 1.1 s and fails, naming the card', () => {
    const v0 = (10 * 19) / 27;
    const times = [1.0, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.4, 1.5];
    const fallFailures = (r: Ran | null, at: Map<number, number>, what: string): string[] => {
      if (!r) return [`${what}: no answer for the card`];
      const failures: string[] = [];
      for (const t of times) {
        const want = t <= 1.1 ? 10 * outCubic((t - 1.0) / 0.3) : t < 1.4 ? v0 * (1 - outCubic((t - 1.1) / 0.3)) : 0;
        const got = lift(r, at.get(t)!);
        if (!near(got, want)) failures.push(`${what}: the card's lift at ${t} s reads ${got} u, not ${want}${t === 1.1 ? ' (the fall must start where the value is, 7.037 u, not at 10 u)' : ''}`);
      }
      return failures;
    };
    const sess = session(1.1, times);
    const bin = canvas.bin();
    none(fallFailures(inputRun(bin, sess.line), sess.at, 'the hover'), 'the fall from where the value is');
    const plantedSession = session(1.1, times);
    failsNaming(fallFailures(inputPlanted(bin, { ...plantedSession.line, planted: 'smoothing_fall_from_peak' }), plantedSession.at, 'the planted smoothing'), ['card', '1.1 s'], 'the planted smoothing that starts the fall from 10 u');
  }, 1_800_000);
});
