// AC7: "Seeking a document of placed items to 50 random times gives the evaluated positions playing gives, bit for bit"
//
// Through #488's seek-against-play comparison, `{"call": "determinism", "doc", "display_hz", "at_times"}`: for each
// time, play is every display frame from the start before t, then t, in one session (warm); seek is a cold jump from a
// second later, then t. Each side answers its canonical render's SHA-256 and each node's result (the SHA-256 of the
// bytes it wrote for its item). The document is presented by an agent's deep_show call and holds an item placed by
// each relation (beside, beside a placed item, edge, align, onto) and one scaled about a box point, all against a
// ball that keyed channels move. No upstream test (the oracle page: "Seek equals play for placed items is our
// invariant").
import { describe, expect, it } from 'vitest';
import { DOC_A, FLICKS, TIMEOUT, deepShow, determinism, loadDoc, none, presented, run, scenario, seeded, useEvidence, useShowBuild } from './helpers.ts';

const build = useShowBuild();
const evidence = useEvidence();

/** 50 distinct random times in [0, 4 s) flicks, seeded so a failure replays. */
function randomTimes(): number[] {
  const next = seeded(221);
  const times = new Set<number>();
  while (times.size < 50) times.add(Math.floor(next() * 4 * FLICKS));
  return [...times].sort((a, b) => a - b);
}
/** The placed items, and those whose place follows the moving ball. */
const PLACED = ['tag', 'note', 'head', 'rail', 'chip', 'grow'];
const FOLLOWS_BALL = ['tag', 'note', 'rail', 'chip'];

describe('AC7 seeking equals playing for placed items', () => {
  it('AC7 seeking a document of placed items to 50 random times gives the evaluated positions playing gives, bit for bit', () => {
    const times = randomTimes();
    const replies = run(build.bin(), scenario(evidence(), [deepShow(loadDoc('placed-film.json')), { call: 'determinism', doc: DOC_A, display_hz: 60, at_times: times }]));
    presented(replies[0]!, 'the document of placed items');
    const frames = determinism(replies[1]!, 'seek against play');
    expect(frames.map((f) => f.t), 'one comparison per random time').toEqual(times);
    const failures: string[] = [];
    for (const f of frames) {
      if (f.play.pixels !== f.seek.pixels) failures.push(`at ${f.t} flicks the seek's frame differs from the play's`);
      for (const [id, p] of f.play.results) {
        const s = f.seek.results.get(id);
        if (!s) failures.push(`at ${f.t} flicks: ${id} (module ${p.module}) is missing from the seek`);
        else if (s.result !== p.result) failures.push(`at ${f.t} flicks: ${id} (module ${p.module}) differs between seek and play`);
      }
      for (const id of f.seek.results.keys()) if (!f.play.results.has(id)) failures.push(`at ${f.t} flicks: ${id} is missing from the play`);
    }
    none(failures, 'seek equals play, bit for bit');
    // Not a vacuous comparison: each placed item is evaluated, and each placed against the moving ball moves.
    const moved: string[] = [];
    for (const item of PLACED) {
      const per = frames.map((f) => [...f.play.results.entries()].filter(([, v]) => v.item === item).map(([k, v]) => `${k}=${v.result}`).sort().join('|'));
      if (per.some((x) => x === '')) moved.push(`${item} has no evaluated node in some frame`);
      else if (FOLLOWS_BALL.includes(item) && new Set(per).size < 2) moved.push(`${item}'s evaluated results are the same at all 50 times, though it is placed against the moving ball`);
    }
    none(moved, 'the placed items are evaluated and follow the ball');
  }, TIMEOUT);
});
