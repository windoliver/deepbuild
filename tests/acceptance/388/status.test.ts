// #388.c1a5581d, the status mark in the core set: a fixture board's status mark draws its state's glyph and
// word beside its color, with a legend; and a planted seal that lets a build without look start draws the
// mark with no glyph and fails, naming the mark. The board is a fixture the core build's own modules (the
// core, text or look) register, with a status binding and the record that gives its source a state; it is
// shown with a render-back snapshot, whose text snapshot of the status marks and the legend (README: The
// status marks and the legend drawn) is held to the clean look's status map and to the PNG's pixels. The
// wrong programs: a mark that draws its color alone, a fixed glyph whatever its state, no legend, and the
// planted seal (`--planted starts_without_look` on core,test-leave-out-look). At the base no core fixture
// has a status binding, snapshots carry no marks or legend, and the test feature doesn't exist.
import { describe, expect, it } from 'vitest';
import {
  FIXTURES, REGISTRY, cleanLook, fixturesOf, isObject, nextStates, none, presented, recordOf, registry, run, scenario, setFailures, show, snapshotOf, statesOf, statusFailures, stored,
  bindingsOf, useBuilds, useEvidence, type Build, type Fixture, type JsonObject,
} from './helpers.ts';

const CORE: Build = { set: 'core' };
const NO_LOOK: Build = { set: 'core', with: ['test-leave-out-look'] };
const builds = useBuilds([CORE, NO_LOOK]);
const evidence = useEvidence();
const LOOK = cleanLook();
/** The planted seal that lets a build without look start (README: The planted seal). */
const STARTS_WITHOUT_LOOK = 'starts_without_look';

/** The core build's fixture boards with a status binding and a record that gives every bound source a state. */
function statusBoards(): Fixture[] {
  const replies = run(builds.bin(CORE), scenario(evidence(), [REGISTRY, FIXTURES]));
  none(setFailures(registry(replies[0]!), 'core'), 'the core build holds exactly text and look', true);
  const boards = fixturesOf(replies[1]!).filter((f) => f.document['profile'] === 'board' && isObject(f.document['status_bindings']) && Object.keys(f.document['status_bindings']).length > 0);
  expect(boards.map((f) => `${f.module}/${f.name}`), 'the core build registers a fixture board with a status mark').not.toEqual([]);
  for (const f of boards) {
    expect(['core', 'text', 'look'], `fixture ${f.module}/${f.name} is registered by the core set`).toContain(f.module);
    const states = statesOf(f.record);
    for (const [id, b] of bindingsOf(f.document)) expect(states[b.source], `fixture ${f.module}/${f.name}'s record gives binding ${id}'s source ${b.source} a state`).toBeDefined();
  }
  return boards;
}

/** The board shown with a snapshot under `record`; the status-color rule's failures on what it drew. */
function drawn(bin: string, f: Fixture, record: JsonObject | undefined, sealPlanted?: string): { failures: string[]; marks: { item: string; state: string; glyph: string | null }[] } {
  const what = `fixture ${f.module}/${f.name}${sealPlanted ? ` with --planted ${sealPlanted}` : ''}`;
  const replies = run(bin, scenario(evidence(), [show(f.document, true)], record ? { record } : {}), sealPlanted);
  presented(replies[0]!, what);
  const snap = snapshotOf(replies[0]!, what);
  const failures = statusFailures(f.document, statesOf(record), snap, stored(evidence(), snap.sha256), LOOK, what);
  return { failures, marks: snap.marks.map((m) => ({ item: m.item, state: m.state, glyph: m.glyph })) };
}

describe('#388.c1a5581d in the core set a fixture board\'s status mark draws its state\'s glyph and word beside its color, with a legend; a planted seal that lets a build without look start draws the mark with no glyph and fails, naming the mark', () => {
  it('#388.c1a5581d in the core build, each fixture board\'s status mark draws the clean look\'s color for its state, the state\'s glyph and word beside it, and a legend entry with that glyph, color and word; with every state moved on, the marks and legend follow', () => {
    const bin = builds.bin(CORE);
    for (const f of statusBoards()) {
      const first = drawn(bin, f, recordOf(f).record);
      none(first.failures, `${f.module}/${f.name}: every status mark carries its state's glyph and word beside its color, with a legend`);
      // A mark that draws one glyph whatever its state, or a legend fixed to the first states, fails here.
      const moved = nextStates(f.record ?? {});
      const second = drawn(bin, f, moved);
      none(second.failures, `${f.module}/${f.name} with every state moved to the next: the marks and the legend follow their states`);
      expect(second.marks.map((m) => m.state), 'the marks draw the moved states').not.toEqual(first.marks.map((m) => m.state));
    }
  }, 900_000);

  it('#388.c1a5581d a planted seal that lets a build without look start (--planted starts_without_look on core,test-leave-out-look) starts with text alone, draws the fixture board\'s status mark with no glyph, and the status check fails, naming the mark', () => {
    const boards = statusBoards();
    const bin = builds.bin(NO_LOOK);
    const reg = registry(run(bin, scenario(evidence(), [REGISTRY]), STARTS_WITHOUT_LOOK)[0]!);
    expect(reg.modules, 'the planted seal starts the build without look').toEqual(['text']);
    for (const f of boards) {
      const planted = drawn(bin, f, recordOf(f).record, STARTS_WITHOUT_LOOK);
      const items = [...bindingsOf(f.document).values()].map((b) => b.item);
      for (const item of items) {
        const m = planted.marks.find((x) => x.item === item);
        expect(m, `the planted build draws mark ${item}`).toBeDefined();
        expect(m!.glyph, `the planted build draws mark ${item} with no glyph`).toBeNull();
      }
      expect(planted.failures.length, `the status check fails on the planted build's board ${f.module}/${f.name}`).toBeGreaterThan(0);
      for (const item of items) expect(planted.failures.join('\n'), `the failure names the mark ${item} and its missing glyph`).toMatch(new RegExp(`mark ${item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\([a-z_]+\\) draws no glyph`));
    }
  }, 900_000);
});
