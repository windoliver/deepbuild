// A probe for #1113's affected.mjs test (README: affected.mjs): it notes the grant it runs under. It is untagged
// and sits outside the suite's own glob, so it runs only when that test hands it to affected.mjs.
import { appendFileSync } from 'node:fs';
import test from 'node:test';

test('probe notes its grant', () => {
  if (process.env.T1113_EVENTS) appendFileSync(process.env.T1113_EVENTS, `${JSON.stringify({ name: 'probe', event: 'start', t: Date.now(), throttle: process.env.DEEP_THROTTLE ?? null, pid: process.pid })}\n`);
});
