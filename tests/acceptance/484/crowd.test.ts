// #484.a2d2a0c9: "A composed crowd's instances output with count from its compact step draws only the rows the step
// kept: 2,000 of 10,000 agents, agents 0, 5, 10 and on flagged alive, draw 2,000 instances by one indirect draw per
// batch, and a click on kept row 999 names agent 4,995, the step's out[999]; a planted draw that takes row r as element
// r names agent 999 and fails, naming the pixel"
//
// The crowd is `helpers.ts: crowdDoc`: 10,000 agents, one batch, on a 100 × 100 grid seen from above at 8 px a metre
// over nothing, 800 × 800. `crowd_state` and `crowd` are composed compute operators; `crowd`'s `drawn` output takes its
// count from its compact step.
//
// One frame, read four ways. `read` gives the step's own results: `crowd.count` is 2,000 and `crowd.kept` holds 5r in
// row r, so out[999] is 4,995. `cull_report` gives what the draw took: 2,000 instances for `agents` in the view.
// `counts` gives exactly one indirect draw for it. And one click at every agent's cell names what drew there: a kept
// agent by name, any other nothing, so an agent the step dropped can't draw and a kept one can't go missing. Agent 999
// stands exactly where agent 4,995 stands (`helpers.ts: place`), and it isn't alive, so that cell is agent 4,995's: the
// click on kept row 999.
//
// `--planted row_as_element` takes row r as element r. Because of that shared place, the click on row 999's pixel
// names agents#999 whichever way the wrong program goes wrong: drawing element 999's own place or writing its ID on
// row 999's. It fails naming the pixel.
import { describe, expect, it } from 'vitest';
import { AC, AGENTS, CROWD_SIZE, CROWD_VIEW, cell, crowdDoc, failsNaming, frameAt, framesOf, none, orthoProject, requireGpu, run, u32File, useGpu, useOut, view3dCall, type Click, type Planted } from './helpers.ts';

const bin = useGpu();
const dir = useOut();
const KEPT = 2000;
const ROW = 999;
const AGENT = 4995;

const pixelOf = (e: number): [number, number] => {
  const [sx, sy] = orthoProject(CROWD_VIEW, CROWD_SIZE, ...cell(e));
  return [Math.floor(sx), Math.floor(sy)];
};

function crowdProblems(planted?: Planted): string[] {
  const out = dir();
  const doc = crowdDoc(bin(), out);
  // Agent 999's own cell stays empty in every right program; it's one of the clicks.
  const cells = Array.from({ length: AGENTS }, (_, e) => e);
  const clicks: Click[] = cells.map((e) => { const [x, y] = pixelOf(e); return { frame: 0, at: [x + 0.5, y + 0.5] }; });
  const [reply] = run(bin(), out, [view3dCall({ doc, size: CROWD_SIZE, counts: true, cull_report: true, read: ['crowd.kept', 'crowd.count'], clicks })], planted);
  const f = frameAt(framesOf(reply!, 'the crowd'), 0, 'the crowd');
  const problems: string[] = [];

  const count = u32File(out, f.read.get('crowd.count') ?? null, 'crowd.count');
  const kept = u32File(out, f.read.get('crowd.kept') ?? null, 'crowd.kept');
  if (count[0] !== KEPT) problems.push(`the step's count is ${String(count[0])}, not ${KEPT}`);
  for (let r = 0; r < KEPT; r++) if (kept[r] !== 5 * r) { problems.push(`the step's out[${r}] is ${String(kept[r])}, not ${5 * r}`); break; }

  const rows = (f.cull ?? []).filter((r) => r.item === 'agents' && r.view === 'view');
  const drawn = rows.reduce((sum, r) => sum + r.count, 0);
  if (rows.length === 0 || drawn !== KEPT) problems.push(`the view drew ${rows.length ? drawn : 'no reported'} instances of agents, not ${KEPT}`);
  const draws = (f.indirect ?? []).filter((d) => d.item === 'agents' && d.view === 'view');
  if (draws.length !== 1) problems.push(`${draws.length} indirect draws of agents in the view, not one for its one batch`);

  expect(f.clicks.length, 'each click is answered').toBe(AGENTS);
  cells.forEach((e, i) => {
    const [x, y] = pixelOf(e);
    const want = e % 5 === 0 ? `agents#${e}` : null;
    const got = f.clicks[i] ?? null;
    if (got !== want) problems.push(`pixel (${x}, ${y}), agent ${e}${e === AGENT ? `, kept row ${ROW}` : ''}: the click names ${got ?? 'nothing'}, not ${want ?? 'nothing'}`);
  });
  return problems;
}

describe(`${AC[3]} an instances output with a count draws only the rows the step kept`, () => {
  it(`${AC[3]} 2,000 of 10,000 agents, every fifth flagged alive, draw 2,000 instances by one indirect draw per batch, and a click on kept row 999 names agent 4,995, the step's out[999]`, () => {
    requireGpu();
    none(crowdProblems(), 'the crowd');
  }, 3_600_000);

  it(`${AC[3]} a planted draw that takes row r as element r (--planted row_as_element) names agent 999 and fails, naming the pixel`, () => {
    requireGpu();
    const [x, y] = pixelOf(AGENT);
    failsNaming(crowdProblems('row_as_element'), [`pixel (${x}, ${y}), agent ${AGENT}, kept row ${ROW}: the click names agents#999`], '--planted row_as_element');
  }, 3_600_000);
});
