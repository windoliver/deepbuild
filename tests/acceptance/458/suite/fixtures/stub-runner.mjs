// A stub lane runner for #458's suite group (README: The surface under test, A lane's runner). The tests lay a copy
// of this file, under a `#!<node>` line, as an executable in a temporary folder and name it in a lane's `runner`
// with one argument, a plan file. It is test code: it draws nothing and decides nothing about a verdict the suite
// owns. It reads one request per stdin line, appends each to `<plan>.log`, and answers one line per request from
// the plan:
//
//   {"device": {"backend", "adapter"?}, "fixtures": {<fixture name>: {"run": Reply, "twins"?: {<twin name>: Reply}}}}
//
// A fixture the plan doesn't hold can't run here (BLOCKED). A twin the plan gives no reply for fails as planned:
// FAIL, and where it names a comparison, that comparison FAIL and the fixture's others as its own run left them.
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';

const planFile = process.argv[2];
const plan = JSON.parse(readFileSync(planFile, 'utf8'));
const digest = (text) => createHash('sha256').update(text).digest('hex');

for (const line of readFileSync(0, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const request = JSON.parse(line);
  appendFileSync(`${planFile}.log`, `${JSON.stringify(request)}\n`);
  const entry = plan.fixtures[request.fixture];
  let reply;
  if (!entry) reply = { verdict: 'BLOCKED', reason: 'the stub has no answer for this fixture' };
  else if (!request.twin) reply = entry.run;
  else {
    reply = entry.twins?.[request.twin.name] ?? {
      verdict: 'FAIL',
      digest: digest(`${request.fixture} ${request.twin.name}`),
      ...(entry.run.comparisons
        ? { comparisons: entry.run.comparisons.map((c) => (c.name === request.twin.comparison ? { ...c, verdict: 'FAIL' } : c)) }
        : {}),
    };
  }
  process.stdout.write(`${JSON.stringify({ ...plan.device, ...reply })}\n`);
}
