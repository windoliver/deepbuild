import { expect, it } from 'vitest';
import { neverEnds } from '../../../packages/hub/src/waits.js';

it('AC5: never-ending commands are recognized by command words and tail follow flags after other options', () => {
  // The existing waits.test.ts:31-32 remains unchanged; these are its uncovered issue cases.
  const follows = [
    'tail -n 100 -f app.log',
    'tail -100f app.log',
    'FOO=1 npm run dev',
    'sudo tail -n 100 -f app.log',
    'npx vitest --watch',
    'exec tail -100f app.log',
    'env FOO=1 tail -n 100 -f app.log',
    'time tail -100f app.log',
    '(tail -n 100 -f app.log)',
    'echo ready; tail -100f app.log',
    'echo ready & tail -100f app.log',
    'echo ready | tail -100f app.log',
  ];
  const finishes = [
    'git commit -m "add more tests"',
    'git checkout -b more-tests',
    'git log | cat',
    'grep -rn serve docs',
    'kubectl logs --tail=100 pod',
  ];
  for (const command of follows) expect.soft(neverEnds(command), command).toBe(true);
  for (const command of finishes) expect.soft(neverEnds(command), command).toBe(false);
});
