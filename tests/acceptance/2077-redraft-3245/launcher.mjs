// #2077's external agents and judge, reused as they are, with the judge's answer to the control #3245 adds
// (REDRAFT.md). No supplied value is an eval outcome.
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launcher as original } from '../2077/launcher.mjs';

export function launcher() {
  const external = original();
  const { trace } = JSON.parse(readFileSync(join(process.env.HOME, '.deepbuild', 'boundary.json'), 'utf8'));
  return {
    ...external,
    async judge(request) {
      // A task's request holds its archived words. The control, the package's own, holds none: of its two outputs the
      // change is the one a git diff shows.
      if (request.prompt.includes('Fix cart item ')) return external.judge(request);
      appendFileSync(trace, JSON.stringify({ kind: 'control', request }) + '\n');
      return request.outputs.map(({ label, text }) => ({ label, score: /^(?:diff --git |@@ |\+)/m.test(text) ? 0.9 : 0.1 }));
    },
  };
}
