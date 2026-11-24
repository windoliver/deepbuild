// #853.a87d0063: "Two runs on one machine reach the same buffer hash at every checkpoint; a comparison of the same
// run on a second machine reads INCONCLUSIVE, naming the class; and an export of the pour reads the bake by hash and
// matches its live frames at 20 sampled times by pixel hash on the recording machine"
//
// All three clauses read the pour (helpers.ts: pourDoc; judges.ts: POUR), through `view3d` at 60 frames a second.
//
// Two runs. Two `deep-gpu` processes each play the pour to 10 s and read `sand.buffer` at every step a checkpoint can
// fall on, the multiples of the ring's `every`: 0, 60, … 600. The eleven hashes are the same in both, they are eleven
// different buffers, and each run reports the same checkpoints, among them the ones the ring's arithmetic holds at
// step 600 (0, 120, … 600). The first run's buffers are the pour stepping (judges.ts: pouringProblems): the live
// count grows from step 0 to step 120 and over 10,000 particles change place between steps 60 and 120.
//
// A second machine. The comparison is the pour at 2.5 s against its recording: #380's `golden` with #252's `read` of
// `sand.buffer` on a `view3d` opened at frame 150, the recording blessed from the buffer's bytes by `decide`. No
// second machine is configured, so one is stood in as #380's and #252's suites do: golden's `environment` gives the
// run another GPU's name. On this machine the buffer passes its own recording and fails a recording with one ulp of
// particle 0's x shifted, so the comparison is real; under the other GPU both read INCONCLUSIVE,
// `environment_changed`, naming both GPUs, with no comparison numbers and the class `same_machine`.
//
// The export. A live play of the pour with `store` records the bake and names its key (README: `bakes`); it is drawn
// with one sample a pixel, live and in an export, so an export's frame is the live frame's picture. A second process
// exports the 20 sampled frames (every half second to 10 s), each a `view3d` of `class: "export"` opened at that
// frame with the same `store`: each names the same bake key, has the live frame's pixel hash, and read the buffer the
// live frame read. The live frames aren't one picture. An export from a store that holds no bake, and an export of
// the pour under another seed from the store that holds this one's, each answer `no_bake` and draw nothing, so the
// export draws from the bake under the document's key, not from a run of its own. At the base no kind
// `particles.stepped@1` exists.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OTHER_SEED, POUR, POUR_BYTES, POUR_STEPS, SAMPLED, SHA, checkpointProblems, exportProblems, isLive, liveCount, pouringProblems, range, ringHeld, secondMachineProblems,
  xOf, type Run, type Shot,
} from './judges.ts';
import {
  LOOK_ONE_SAMPLE, SAND, ac, bakeKey, blessState, bufferOn, carriedOn, checkpointsTaken, frameAt, goldenRead, goldenState, judgesHold, none, pourDoc, requireGpu, run,
  shown, useBin, useOut, view3dCall, view3dFrames, writeJson, type Buffered, type JsonObject,
} from './helpers.ts';

const bin = useBin();
const out = useOut();
const LAST = POUR_STEPS.tenSeconds;
/** Every step a checkpoint of the pour's ring can fall on in 10 s: the multiples of its `every`, 60. */
const CHECKPOINTS = range(0, LAST / POUR.every).map((k) => k * POUR.every);
const FIXTURE = 'pour-853';
/** The second machine: another GPU's name in the run's fingerprint. */
const OTHER = { gpu: 'the GPU of a second machine (#853)' };

describe(`${ac(3)} the pour's buffer is the same on one machine, never compared on another, and exported from its bake`, () => {
  it(`${ac(3)} two runs on one machine reach the same buffer hash at every checkpoint`, () => {
    judgesHold();
    requireGpu();
    const dir = out();
    const doc = writeJson(dir, 'pour.json', pourDoc());
    const buffers = new Map<number, Buffered>();
    const play = (which: string): Run => {
      const what = `the ${which} run of the pour`;
      const [reply] = run(bin(), dir, [view3dCall({ doc, frames: LAST + 1, capture: CHECKPOINTS, read: [SAND] })]);
      const frames = view3dFrames(reply!, what);
      const hashes = new Map<number, string>();
      for (const s of CHECKPOINTS) {
        const f = frameAt(frames, s, what);
        expect(carriedOn(f, SAND, what).step, `${what}: frame ${s} reads the buffer at step ${s}`).toBe(s);
        const b = bufferOn(dir, f, SAND, what);
        hashes.set(s, b.hash);
        if (which === 'first') buffers.set(s, b);
      }
      return { hashes, taken: checkpointsTaken(frames, SAND, what) };
    };
    const first = play('first');
    const second = play('second');
    none(pouringProblems({ 0: buffers.get(0)!.words, 60: buffers.get(60)!.words, 120: buffers.get(120)!.words, 600: buffers.get(600)!.words }, POUR), 'the first run\'s buffers are the pour stepping');
    none(checkpointProblems(first, second, CHECKPOINTS, ringHeld(LAST, POUR.every, POUR.budget, POUR_BYTES)), 'the two runs reach the same buffer hash at every checkpoint');
  }, 3_600_000);

  it(`${ac(3)} a comparison of the same run on a second machine reads INCONCLUSIVE, naming the class same_machine, where on the recording machine it passes its recording and fails one an ulp off`, () => {
    judgesHold();
    requireGpu();
    const dir = out();
    const at = POUR_STEPS.sought;
    const what = 'the pour opened at 2.5 s';
    const spec: JsonObject = { doc: writeJson(dir, 'pour.json', pourDoc()), from: at, frames: 1 };
    const [opened] = run(bin(), dir, [view3dCall({ ...spec, capture: [at], read: [SAND] })]);
    const f = frameAt(view3dFrames(opened!, what), at, what);
    expect(carriedOn(f, SAND, what).step, `${what} reads the buffer at step ${at}`).toBe(at);
    const b = bufferOn(dir, f, SAND, what);
    expect(b.bytes.byteLength, 'the buffer is 100,000 particles of 7 f32 words').toBe(POUR_BYTES);
    expect(liveCount(b.words, POUR.count), 'at 2.5 s every particle of the pour is live').toBe(POUR.count);
    expect(isLive(b.words, 0) && Number.isFinite(xOf(b.words, 0)), `particle 0 is a live particle at a finite x (${xOf(b.words, 0)})`).toBe(true);
    // Two recordings: the buffer as it is, and with one ulp of one field shifted (particle 0's x, word 0).
    const same = join(dir, 'same.state');
    writeFileSync(same, b.bytes);
    const words = new Uint32Array(b.bytes.buffer.slice(b.bytes.byteOffset, b.bytes.byteOffset + b.bytes.byteLength));
    words[0] = words[0]! + 1;
    const shifted = join(dir, 'shifted.state');
    writeFileSync(shifted, Buffer.from(words.buffer));
    const stores = { same: join(dir, 'golden-same'), shifted: join(dir, 'golden-shifted') };
    const decided = run(bin(), dir, [blessState(stores.same, FIXTURE, same), blessState(stores.shifted, FIXTURE, shifted)]);
    decided.forEach((d, i) => expect(d['outcome'], `your blessing ${i} is decided: ${shown(d)}`).toBe('decided'));
    const v = view3dCall(spec);
    const [here, hereShifted, there, thereShifted] = run(bin(), dir, [
      goldenState(stores.same, FIXTURE, v, SAND), goldenState(stores.shifted, FIXTURE, v, SAND),
      goldenState(stores.same, FIXTURE, v, SAND, OTHER), goldenState(stores.shifted, FIXTURE, v, SAND, OTHER),
    ]).map(goldenRead);
    expect(here!.verdict, `on the recording machine the pour passes its recording: ${shown(here!.raw)}`).toBe('PASS');
    expect(here!.cls, 'the comparison names the buffer\'s class, same_machine').toBe('same_machine');
    expect(hereShifted!.verdict, `on the recording machine a recording one ulp off fails, so the comparison runs: ${shown(hereShifted!.raw)}`).toBe('FAIL');
    expect(hereShifted!.numbers, 'with its numbers').toBe(true);
    none(secondMachineProblems(there!, OTHER.gpu, 'unshifted'), 'the same run against its recording on a second machine reads INCONCLUSIVE, naming the class');
    none(secondMachineProblems(thereShifted!, OTHER.gpu, 'shifted'), 'and so does a recording one ulp off: nothing is compared there');
  }, 3_600_000);

  it(`${ac(3)} an export of the pour reads the bake by hash and matches its live frames at 20 sampled times by pixel hash on the recording machine`, () => {
    judgesHold();
    requireGpu();
    const dir = out();
    const doc = writeJson(dir, 'pour.json', pourDoc());
    const [store, empty] = [join(dir, 'store'), join(dir, 'empty-store')];
    mkdirSync(store);
    mkdirSync(empty);
    const exportOf = (d: string, from: string, frame: number): JsonObject => view3dCall({ doc: d, look: LOOK_ONE_SAMPLE, class: 'export', store: from, from: frame, frames: 1, capture: [frame], read: [SAND] });

    // The recording machine's live play, which records the bake.
    const what = 'the live play of the pour';
    const [played] = run(bin(), dir, [view3dCall({ doc, look: LOOK_ONE_SAMPLE, store, frames: LAST + 1, capture: SAMPLED, read: [SAND] })]);
    const frames = view3dFrames(played!, what);
    const live = new Map<number, Shot>();
    for (const n of SAMPLED) {
      const f = frameAt(frames, n, what);
      expect(carriedOn(f, SAND, what).step, `${what}: frame ${n} reads the buffer at step ${n}`).toBe(n);
      live.set(n, { pixel: f.pixelHash, buffer: bufferOn(dir, f, SAND, what).hash });
    }
    const key = bakeKey(played!, SAND);
    expect(key ?? '', `${what} names the key it recorded the bake of ${SAND} under: bakes is ${shown(played!['bakes'])}`).toMatch(SHA);

    // The export, in another process: each sampled frame from the bake.
    const replies = run(bin(), dir, [
      ...SAMPLED.map((n) => exportOf(doc, store, n)),
      exportOf(doc, empty, POUR_STEPS.fiveSeconds),
      exportOf(writeJson(dir, 'pour-seeded.json', pourDoc(OTHER_SEED)), store, POUR_STEPS.fiveSeconds),
    ]);
    const exported = new Map<number, Shot>();
    const keys = new Set<string>();
    SAMPLED.forEach((n, i) => {
      const f = frameAt(view3dFrames(replies[i]!, `the export at frame ${n}`), n, `the export at frame ${n}`);
      exported.set(n, { pixel: f.pixelHash, buffer: f.read.get(SAND) ?? null });
      keys.add(bakeKey(replies[i]!, SAND) ?? 'none');
    });
    none(exportProblems(live, exported, { live: key, exported: [...keys].join(' and ') }), 'the export reads the bake the live play recorded and matches its frames at the 20 sampled times by pixel hash');

    // Without the bake under its key the export draws nothing: it never steps live.
    const [unbaked, seeded] = [replies[SAMPLED.length]!, replies[SAMPLED.length + 1]!];
    expect(unbaked['code'], `an export from a store that holds no bake answers no_bake, and draws no frame: ${shown(unbaked).slice(0, 400)}`).toBe('no_bake');
    expect(unbaked['key'], 'naming the key it looked under, the live play\'s').toBe(key);
    expect(seeded['code'], `an export of the pour under another seed, from the store that holds this pour's bake, answers no_bake: ${shown(seeded).slice(0, 400)}`).toBe('no_bake');
    expect(String(seeded['key']), 'naming a key').toMatch(SHA);
    expect(seeded['key'], 'which is another key than this pour\'s').not.toBe(key);
  }, 3_600_000);
});
