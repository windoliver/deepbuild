// AC6: a test check plug-in reads items/door/params/open at 0, 1 and 2 s through deep.canvas.read and gets the
// values and content keys deep_query returns for the same revision; a read of a document its grant doesn't cover
// returns ref_unresolved for every path; and a result it reports as PASS without the read's content keys as
// evidence is refused by the validator, naming the plug-in.
//
// One canvas core (`deep-show canvas`, the hub's long-lived one) holds alpha's two doors. The extension host gets
// that core as its canvas (README: Surfaces), and the door reader, a first-party test package in the hub
// (fixtures/door-reader), is installed under a grant that covers the first door only. Its runner writes each reply
// deep.canvas.read gave it to a file the test reads. "The validator" is read as the core's gate on a check result,
// `runCheck`, which already refuses a passed run that counted no test (#349).
import { describe, expect, it } from 'vitest';
import {
  ALPHA, DOC, DOOR_PACK, FULL, KEY, OPEN, PANELS, PROCESSES, READER_ID, SESSIONS, ANGLE, type JsonObject, type JsonValue, arr, brief, door, isObject, keys, loadReader, obj,
  openCanvasCore, runReader, tempDir, useBuilds, values,
} from './helpers.ts';

const builds = useBuilds([FULL]);
const TIMES = ['0s', '1s', '2s'];

describe('AC6 a test check plug-in reads through deep.canvas.read what deep_query returns, only under its grant, and its PASS needs the read\'s content keys', () => {
  it('AC6 the plug-in\'s read equals deep_query\'s for the same revision; outside its grant every path is ref_unresolved; a PASS without the keys is refused naming the plug-in', async () => {
    const evidence = tempDir('evidence');
    const core = await openCanvasCore(builds.bin(FULL), {
      evidence, sessions: SESSIONS, processes: PROCESSES, panels: PANELS, packs: [DOOR_PACK],
      docs: { [DOC.a]: { panel: 'main' }, [DOC.b]: { panel: 'main' } },
    } as JsonObject);
    try {
      const shownA = await core.call({ call: 'deep_show', session: ALPHA.id, doc: DOC.a, document: door(), include: ['issues'] });
      const shownB = await core.call({ call: 'deep_show', session: ALPHA.id, doc: DOC.b, document: door(), include: ['issues'] });
      expect([shownA['outcome'], shownB['outcome']], `both doors are presented (${brief(shownA as JsonObject, 800)})`).toEqual(['presented', 'presented']);
      const revA = shownA['rev'] as number;
      const revB = shownB['rev'] as number;
      const q = await core.call({ call: 'deep_query', session: ALPHA.id, doc: DOC.a, rev: revA, paths: [OPEN], at: TIMES }) as JsonObject;
      const qValues = values(q, OPEN);
      const qKeys = keys(q, OPEN);
      expect(qValues, `deep_query reads the door's open at 0, 1 and 2 s (${brief(q, 1200)})`).toEqual([0.5, 0.5, 0.5]);
      for (const k of qKeys) expect(String(k), 'each with its content key').toMatch(KEY);

      const reader = await loadReader(core, [DOC.a]);

      // The plug-in's read of the door its grant covers: deep_query's values and keys, and its PASS goes through.
      const granted = await runReader(reader, { reads: [{ doc: DOC.a, rev: revA, paths: [OPEN], at: TIMES }], evidence: 'keys' });
      expect(granted.seen.length, `the runner read once (${brief(granted.seen as unknown as JsonValue, 1200)})`).toBe(1);
      const read = obj(granted.seen[0]!.reply, 'what deep.canvas.read returned');
      expect(obj(read['values'], `the read's values (${brief(read, 1200)})`)[OPEN], 'the plug-in gets deep_query\'s values').toEqual(qValues);
      expect(obj(read['keys'], 'the read\'s content keys')[OPEN], 'and deep_query\'s content keys').toEqual(qKeys);
      expect(read['coverage'], 'with a coverage block').toBeDefined();
      expect(granted.result.outcome, `a PASS resting on the read's content keys goes through (${JSON.stringify(granted.result)})`).toBe('passed');
      expect(granted.result.evidence, 'with those keys as its evidence').toEqual(qKeys);

      // A document its grant doesn't cover: every path ref_unresolved, no value.
      const outside = await runReader(reader, { reads: [{ doc: DOC.b, rev: revB, paths: [OPEN, ANGLE], at: TIMES }], evidence: 'keys' });
      const denied = obj(outside.seen[0]?.reply, `what deep.canvas.read returned outside the grant (${brief(outside.seen as unknown as JsonValue, 1200)})`);
      const unresolved = arr(denied['unresolved'], `the read's unresolved list (${brief(denied, 1200)})`).filter(isObject);
      for (const path of [OPEN, ANGLE]) {
        expect(unresolved.some((u) => u['path'] === path && u['code'] === 'ref_unresolved'), `${path} comes back ref_unresolved`).toBe(true);
        const v = isObject(denied['values']) ? denied['values'][path] : undefined;
        expect(Array.isArray(v) ? v.filter((x) => x !== null) : [], `no value for ${path}`).toEqual([]);
      }

      // The planted runner: PASS without the read's content keys as evidence, refused, naming the plug-in.
      const bare = await runReader(reader, { reads: [{ doc: DOC.a, rev: revA, paths: [OPEN], at: TIMES }], evidence: 'none' });
      expect(bare.seen.length, 'the planted runner still read the door').toBe(1);
      expect(bare.result.outcome, `a PASS without the read's content keys is refused (${JSON.stringify(bare.result)})`).not.toBe('passed');
      expect(bare.result.failures.map((f) => f.message).join('\n'), 'the refusal names the plug-in').toContain(READER_ID);
    } finally {
      core.close();
    }
  }, 600_000);
});
