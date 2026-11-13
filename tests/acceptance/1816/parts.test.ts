// #1816 AC5: `parts()` dropped each part's `why`, so a BLOCKED part didn't say why. Done when an issue split into parts
// reads each BLOCKED part with the reason that part's own judgment gives.
//
// The fixture: spine task #12 is split into one part (its body's `### Parts`: `- #13 …`); #13 has one criterion and
// lands a test, but the workspace packages/w's build exits 3 at the commit, so #13 reads BLOCKED with a why. The spine's
// table names the fixture's commit for #12 and #13 alike; #13 judged on its own gives that why, and #12's entry for its
// part must carry it.
import { afterAll, beforeAll, describe, it } from 'vitest';
import { AC5, cleanup, commit, git, idOf, judge, makeFixture, must, pointSpine, shown, type Fixture, type Judging } from './helpers.ts';

const PART = '#13 the part whose workspace does not build';
let fx: Fixture;
let T = '';
let part: Judging, whole: Judging;

beforeAll(() => {
  const made = makeFixture({
    'package.json': '{"name":"fx","private":true,"workspaces":["packages/*"]}\n',
    'packages/w/package.json': '{"name":"w","version":"1.0.0","scripts":{"build":"node -e \\"console.error(\'DH1816 build broke\'); process.exit(3)\\""}}\n',
  }, {
    12: `## Scope\n\nSplit into parts.\n\n### Parts\n\n- ${PART}\n`,
    13: '### Acceptance criteria\n\n- [ ] the part\'s test passes\n',
  });
  fx = made.fx;
  T = commit(fx, {
    'tests/acceptance/13/part.test.mjs': `import { test } from 'node:test';
test('AC1 the part passes once it builds', () => {});
`,
  }, 'the part: Closes #13');
  git(fx.root, fx.tmp, 'push', '-q', 'origin', 'main');
  pointSpine(fx, 12, T);
  pointSpine(fx, 13, T);
  part = judge(fx, 13);
  whole = judge(fx, 12);
}, 900_000);
afterAll(cleanup);

describe(`${AC5} parts() drops each part's why, so a BLOCKED part doesn't say why`, () => {
  it(`${AC5} #12, split into parts, reads its BLOCKED part #13 with the why #13's own judgment gives`, () => {
    const own = part.lines.find((l) => l.issue === 13);
    must(own !== undefined && own.verdict === 'BLOCKED' && typeof own.why === 'string' && own.why.length > 0, `BLOCKED: the fixture is wrong: #13 judged on its own should read BLOCKED with a why: ${shown(part)}`);
    const line = whole.lines.find((l) => l.issue === 12);
    must(line !== undefined, `${AC5} the spine prints a judgment of #12: ${shown(whole)}`);
    const entry = line.criteria.find((c) => c.id === idOf(12, PART));
    must(entry !== undefined, `${AC5} #12's part ${idOf(12, PART)} is judged: ${JSON.stringify(line)}`);
    must(entry.outcome === 'BLOCKED' && line.verdict === 'BLOCKED', `${AC5} the part reads BLOCKED, and so #12: ${JSON.stringify(line)}`);
    const said = JSON.stringify(entry);
    must(said.includes(JSON.stringify(own.why).slice(1, -1)), `${AC5} the BLOCKED part says why, as #13's own judgment does (${JSON.stringify(own.why)}): #12 reads it ${said}`);
  });
});
