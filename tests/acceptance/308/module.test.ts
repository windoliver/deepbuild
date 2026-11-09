// AC1 #308: "The input module seals as `input@1`'s implementation and passes its kit: a recorded session with a
// slider, a stages control and a drag_along handle replays at 30, 60 and 120 fps to one input-track hash; a planted
// implementation that computes the drag_along entry again from the camera at replay reads a different value once the
// camera has moved and fails, naming the control; and a film with no controls gives the same evaluated-data hash on
// a build without the input module, where a document with a slider is refused with `module_missing`, naming the
// input module"
//
// AC2 #308: "control@1 seals with its first nine entries, slider, toggle, choice, stages, transport, drag_along,
// turn, press and hover, each passing the kit; a planted test kind whose entry is computed again from the camera at
// replay fails the kit's replay part at the seal, naming the kind; one with no keyboard path is refused, naming it;
// one whose entry an agent's input writes is refused, naming it; and a pack that declares an entry of control@1 is
// refused at pack check, naming the registry and who may fill it"
import { describe, expect, it } from 'vitest';
import {
  BEAD, DIALPACK, DOC_A, FPS, GAIN, KNOB, MODE, PACKS, RAIL_CONTROL, REGISTRIES, canon, doc, down, evalCall, failsNaming, inputPlanted, inputRuns, kitCall,
  kitModule, listedRegistry, mentions, move, none, panCamera, present, read, refusalFailures, run, scenario, sealFailures, seek, setControl, show, showDoc,
  startup, up, useBuilds, useCanvas, useEvidence, packAt, type Build, type InputLine, type Ran,
} from './helpers.ts';

const canvas = useCanvas();
const PLAIN: Build = { set: 'full' };
const NO_INPUT: Build = { set: 'full', with: ['test-leave-out-input'] };
const TEST_KIND: Build = { set: 'full', with: ['test-control-kind'] };
const builds = useBuilds([PLAIN, NO_INPUT, TEST_KIND]);
const evidence = useEvidence();

const NINE = ['slider', 'toggle', 'choice', 'stages', 'transport', 'drag_along', 'turn', 'press', 'hover'];
const PARTS = ['replay', 'read_region', 'keyboard', 'input'];

// ---------------------------------------------------------------------------------------------------- AC1

const SESSION_DOC = doc('session', [KNOB, BEAD], { gain: GAIN, mode: MODE, rail: RAIL_CONTROL });
const sessionLine = (extra: Partial<InputLine> = {}): InputLine => ({
  doc: SESSION_DOC, viewport: [640, 360],
  ops: [
    down(206, 180, 1.0123), move(216, 180, 1.0501), move(226, 180, 1.1049, ['shift']), up(226, 180, 1.2002), // the slider
    setControl('mode', 'b', 2.0071), // the stages control
    down(100, 100, 3.0), move(150, 130, 3.1017), move(240, 160, 3.2503), up(240, 160, 3.3), // the drag_along handle
    panCamera(-120, 0, 4.0), // the camera moves
    seek(3.5), read('rail', 3.5), read('gain', 3.5), read('mode', 3.5),
  ],
  ...extra,
});
/** Each rate's hash is the first's, and the rail reads at the replay what its entry recorded. Failures name the control. */
function replayFailures(runs: (Ran | null)[], what: string): string[] {
  const failures: string[] = [];
  const first = runs[0];
  runs.forEach((r, i) => {
    const fps = FPS[i]![0];
    if (!r) { failures.push(`${what}: no answer at ${fps} fps for the control rail`); return; }
    if (first && r.hash !== first.hash) failures.push(`${what}: at ${fps} fps the input-track hash is ${r.hash}, not ${first.hash}`);
    const rail = r.track.filter((e) => e.control === 'rail');
    const reads = r.results[r.results.length - 3]!.value;
    if (rail.length !== 1) failures.push(`${what}: the track holds ${rail.length} entries for the control rail, not 1`);
    else if (canon(reads) !== canon(rail[0]!.value)) failures.push(`${what}: at ${fps} fps the control rail reads ${show(reads)} at the replay after the camera moved, but its entry recorded ${show(rail[0]!.value)}`);
  });
  return failures;
}

describe('AC1 #308 the input module seals as input@1\'s implementation and passes its kit', () => {
  it('AC1 a recorded session with a slider, a stages control and a drag_along handle replays at 30, 60 and 120 fps to one input-track hash; a planted implementation that computes the drag_along entry from the camera at replay fails, naming the control', () => {
    const bin = canvas.bin();
    const real = inputRuns(bin, FPS.map((fps) => sessionLine({ fps })));
    none(replayFailures(real, 'the input module'), 'the recorded session');
    const e = real[0]!.track;
    expect(e.map((x) => x.control).sort(), 'one entry each for the slider, the stages control and the drag_along handle').toEqual(['gain', 'mode', 'rail']);
    for (const x of e) expect([x.writer, typeof x.serial], `the entry of ${x.control} is yours, with its gesture serial`).toEqual(['you', 'number']);
    const planted = FPS.map((fps) => inputPlanted(bin, sessionLine({ fps, planted: 'drag_along_recompute' })));
    failsNaming(replayFailures(planted, 'the planted implementation'), ['rail'], 'the planted implementation that computes drag_along from the camera');
  }, 1_800_000);

  it('AC1 the sealed set holds input as the implementation of input@1, its kit passes (replay, keyboard, input), and a drag_along entry computed again from the camera is refused at the seal, naming it', () => {
    const bin = builds.bin(PLAIN);
    const [reg, sched, kit] = run(bin, scenario(evidence(), [{ call: 'registry' }, { call: 'schedule' }, kitCall(['input'])]));
    expect(mentions(reg!['modules'], '"input"'), 'the sealed set holds the module input').toBe(true);
    const iface = (sched!['interfaces'] as { [k: string]: { module?: string; digest?: string } } | undefined)?.['input@1'];
    expect(iface, `the schedule names the interface input@1: ${show(sched!['interfaces'])}`).toBeDefined();
    expect(iface!.module, 'input@1\'s implementing module').toBe('input');
    expect(iface!.digest, 'input@1\'s digest is its module\'s').toBe((reg!['digests'] as { [k: string]: string })['input']);
    const m = kitModule(kit!, 'input');
    expect(m.verdict, `the kit passes the input module: ${show(m.failures)}`).toBe('PASS');
    for (const part of ['replay', 'keyboard', 'input']) {
      const p = m.parts.find((x) => x.part === part);
      expect([part, p?.verdict], `the kit runs the part ${part} on the input module and it passes`).toEqual([part, 'PASS']);
    }
    // The planted implementation: its drag_along entry is computed again from the camera at replay.
    none(refusalFailures(startup(bin, 'input_drag_along_recompute'), { reasons: ['entry_refused'], registry: 'control@1', entries: ['drag_along'], rules: ['replay'] }), 'the planted drag_along');
  }, 1_800_000);

  it('AC1 a film with no controls gives the same evaluated-data on a build without the input module, where a document with a slider is refused with module_missing, naming the input module', () => {
    const film = showDoc('plain');
    const sliderDoc = showDoc('slider', { gain: { kind: 'slider', class: 'document', label: 'Gain', role: 'slider', range: [0, 1], default: 0.5 } });
    const calls = [present(DOC_A, film), evalCall(DOC_A), { call: 'registry' }];
    const [, withEval, withReg] = run(builds.bin(PLAIN), scenario(evidence(), calls));
    const [, withoutEval, withoutReg] = run(builds.bin(NO_INPUT), scenario(evidence(), calls));
    expect(mentions(withReg!['modules'], '"input"'), 'the full build holds the input module').toBe(true);
    expect(mentions(withoutReg!['modules'], '"input"'), 'the build without it does not').toBe(false);
    expect(Array.isArray(withEval!['nodes']) && (withEval!['nodes'] as unknown[]).length > 0, `the film evaluates to nodes: ${show(withEval)}`).toBe(true);
    expect(canon(withoutEval!['nodes']), 'a film with no controls gives the same evaluated data (every node\'s key and bytes) without the input module').toBe(canon(withEval!['nodes']));
    const [shown] = run(builds.bin(PLAIN), scenario(evidence(), [present(DOC_A, sliderDoc)]));
    expect(mentions(shown, 'module_missing'), `the build with the input module accepts a slider: ${show(shown)}`).toBe(false);
    const [refused] = run(builds.bin(NO_INPUT), scenario(evidence(), [present(DOC_A, sliderDoc)]));
    expect(mentions(refused, 'module_missing'), `the build without it refuses a document with a slider with module_missing: ${show(refused)}`).toBe(true);
    expect(mentions(refused, 'input'), `the refusal names the input module: ${show(refused)}`).toBe(true);
  }, 1_800_000);
});

// ---------------------------------------------------------------------------------------------------- AC2

describe('AC2 #308 control@1 seals with its first nine entries; kinds come only from canvas modules and pass the kit', () => {
  it('AC2 control@1 is owned by input, filled by modules at the seal, and lists exactly slider, toggle, choice, stages, transport, drag_along, turn, press and hover, each passing the kit with a role and a keyboard path, and a planted wrong entry for each kit part', () => {
    const [reply] = run(builds.bin(PLAIN), scenario(evidence(), [REGISTRIES]));
    const l = listedRegistry(reply!, 'control@1');
    expect([l.owner, l.fill, l.resolve], 'control@1: {owner: input, fill: [module], resolve: seal}').toEqual(['input', ['module'], 'seal']);
    expect(PARTS.every((p) => l.kit.includes(p)), `control@1's kit lists the parts ${PARTS.join(', ')}: ${l.kit.join(', ')}`).toBe(true);
    expect(l.entries.map((e) => e.name).sort(), 'its first entries are the nine core kinds').toEqual([...NINE].sort());
    const failures: string[] = [];
    for (const e of l.entries) {
      if (e.origin !== 'first_party' || e.module !== 'input') failures.push(`${e.name} is origin ${e.origin} from module ${e.module}, not first_party from input`);
      if (e.kit.verdict !== 'PASS') failures.push(`${e.name}'s kit result is ${e.kit.verdict}: ${show(e.kit.raw)}`);
      for (const part of PARTS) if (!e.kit.rules.some((r) => r.rule === part && r.verdict === 'PASS')) failures.push(`${e.name} has no passing kit part ${part}`);
      const v = e.value;
      if (!Array.isArray(v['classes']) || v['classes'].length === 0 || !v['classes'].every((c) => ['document', 'view', 'viewer'].includes(String(c)))) failures.push(`${e.name}: classes is ${show(v['classes'])}`);
      if (!Array.isArray(v['sources']) || v['sources'].length === 0) failures.push(`${e.name}: sources is ${show(v['sources'])}`);
      if (typeof v['role'] !== 'string' || v['role'] === '') failures.push(`${e.name} has no ARIA role: ${show(v['role'])}`);
      if (v['keyboard'] === undefined || v['keyboard'] === null || v['keyboard'] === '') failures.push(`${e.name} has no keyboard path: ${show(v['keyboard'])}`);
      const rr = v['read_region'] as { bytes?: unknown; layout?: unknown } | undefined;
      if (!rr || typeof rr.bytes !== 'number' || typeof rr.layout !== 'string' || rr.layout === '') failures.push(`${e.name}: read_region is ${show(rr as never)}, not {bytes, layout digest}`);
    }
    none(failures, 'the nine entries');
    for (const part of PARTS) {
      const p = l.planted.find((x) => x.result.verdict === 'FAIL' && x.result.rules.some((r) => r.verdict === 'FAIL' && r.rule === part));
      expect(p, `control@1 has a planted wrong entry for the part ${part}; planted: ${l.planted.map((x) => `${x.name}: ${x.result.rules.filter((r) => r.verdict === 'FAIL').map((r) => r.rule).join('+')}`).join(', ')}`).toBeDefined();
      expect(mentions(p!.result.raw, p!.name), `the kit's result for the planted ${p!.name} names it`).toBe(true);
    }
  }, 1_800_000);

  it('AC2 a planted test kind computed again from the camera at replay fails the replay part at the seal, naming the kind; one with no keyboard path is refused, naming it; one an agent\'s input writes is refused, naming it; the same kind unplanted seals', () => {
    const bin = builds.bin(TEST_KIND);
    none(sealFailures(startup(bin), 'the test kind test.dial'), 'the control kind test.dial, unplanted');
    const [reply] = run(bin, scenario(evidence(), [REGISTRIES]));
    const dial = listedRegistry(reply!, 'control@1').entries.find((e) => e.name === 'test.dial');
    expect([dial?.module, dial?.kit.verdict], 'test.dial is filled by the module test.dial and passes the kit').toEqual(['test.dial', 'PASS']);
    for (const [planted, part] of [['control_kind_recompute', 'replay'], ['control_kind_no_keyboard', 'keyboard'], ['control_kind_agent_input', 'input']] as const) {
      none(refusalFailures(startup(bin, planted), { reasons: ['entry_refused'], registry: 'control@1', entries: ['test.dial'], rules: [part] }), `the kind test.dial planted as ${planted}`);
    }
  }, 1_800_000);

  it('AC2 a pack that declares an entry of control@1 is refused at pack check, naming the registry and who may fill it', () => {
    const [packs] = run(builds.bin(PLAIN), scenario(evidence(), [PACKS], { packs: [DIALPACK] }));
    const rows = (packs!['packs'] as { [k: string]: unknown }[]).filter((r) => r['pack'] === DIALPACK.id && r['version'] === DIALPACK.version);
    expect(rows.length, `the packs reply has one row for ${packAt(DIALPACK)}`).toBe(1);
    const row = rows[0]!;
    expect(row['state'] ?? row['outcome'], `${packAt(DIALPACK)} is refused at its pack check`).toBe('refused');
    const errors = ((row['issues'] as { [k: string]: unknown }[] | undefined) ?? []).filter((i) => i['severity'] === 'error' || i['severity'] === undefined);
    for (const name of ['control@1', 'module']) expect(errors.some((i) => JSON.stringify(i).includes(name)), `the refusal names ${name}: ${JSON.stringify(errors).slice(0, 600)}`).toBe(true);
  }, 1_800_000);
});
