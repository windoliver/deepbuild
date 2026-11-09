// AC1 #432.e6a02864: A depth-equal pass between geometry and its prepass leaves no missing pixel on a fixture, and the
// first frame of every fixture document compiles no pipeline.
//
// Redraft (dispute D1, README): only the first-frame test. The depth-equal pixel test stays the original's
// (tests/acceptance/432/depth-equal.test.ts); its ball documents have no controls, so D1 doesn't touch it.
//
// "Every fixture document" is every document this suite plays (helpers: `everyFixture`): both balls, AC2's chain fused and
// unfused, AC4's product figure in both channel forms and its accepted cap figure, AC5's finish figure with two and with
// three variant sets, and AC6's shadow scene. Each control in them now carries its ARIA role (helpers: a toggle
// `switch`, a choice `radiogroup`), so the core's check admits them. Each is opened in `live` for two frames on the noop
// lane and, on macOS, on Metal; the first frame its view draws must list no created pipeline (`created`, README: The
// surface under test).
// Wrong program: a warm-up that leaves a pipeline to the first frame (named, with its items, feature set and target).
import { describe, expect, it } from 'vitest';
import {
  AC, WRITER, everyFixture, firstDrawn, liveCall, liveReply, named, num, obj, payload, requireGpu, run, sessionRow, shown,
  useBin, useOut, viewsOf, writeJson, type Lane, type Size,
} from './helpers.ts';

const bin = useBin();
const out = useOut();
const FPS = 30;

describe(`${AC[1]} a depth-equal pass leaves no missing pixel, and no fixture's first frame compiles a pipeline`, () => {
  it(`${AC[1]} the first frame of every fixture document compiles no pipeline, on the noop lane and on Metal`, () => {
    const dir = out();
    const docs = Object.entries(everyFixture());
    const lanes: Lane[] = process.platform === 'darwin' ? ['noop', 'gpu'] : ['noop'];
    for (const lane of lanes) {
      const calls = docs.map(([name, doc]) => liveCall({
        frames: 2, fps: FPS,
        sessions: [{ session: name, writer: WRITER, doc: writeJson(dir, `${name}-${lane}.json`, payload(doc)), size: obj(doc, name)['size'] as unknown as Size }],
      }));
      const replies = run(bin(), dir, calls, { lane });
      const problems: string[] = [];
      docs.forEach(([name], i) => {
        const live = liveReply(replies[i]!, `${name} on ${lane}`);
        const row = sessionRow(live, name);
        if (row['state'] !== 'live') { problems.push(`${lane}: ${name} was not admitted: ${shown(row)}`); return; }
        const first = firstDrawn(live, name);
        if (first === null) { problems.push(`${lane}: ${name} drew no frame`); return; }
        const v = viewsOf(live, name).find((x) => x.frame === first)!;
        for (const c of v.created) problems.push(`${lane}: ${name}: its first frame: ${named(c, first, FPS)}`);
        num(v.operator_pipelines, `${name}: operator_pipelines`);
      });
      console.log(`${AC[1]}: ${lane}: ${docs.length} fixture documents, ${problems.length} problems${problems.length ? `, first: ${problems[0]}` : ''}`);
      expect(problems, `${lane}: no fixture document compiles a pipeline in its first frame`).toEqual([]);
    }
    requireGpu();
  }, 1_800_000);
});
