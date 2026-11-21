// #1334 AC2 on the rollback scene with a planted build that starts, answers and judges claims wrong (README: The
// scenes): its bin/deep runs this checkout's CLI with DEEP_HUB_PLANT=judges-claims-wrongly.
//
// Redraft 1865 (REDRAFT.md): a copy of tests/acceptance/1334/misjudge.test.mjs. Unchanged but for this note and the names'
// " (redraft 1865)": the scene's restart now really stops the hub (./helpers.mjs, stopHub, by its PID with SIGTERM),
// since #1865 refuses the installed hub's hub.stop on the control token alone and the original's stop was then a no-op.
import { after, before, test } from 'node:test';
import { LONG, MISJUDGES, rolledBack, rollbackScene } from './helpers.mjs';

let scene;
const cleanups = [];
after(async () => { for (const cleanup of cleanups) await cleanup(); });
before(async () => { scene = await rollbackScene({ after: (cleanup) => cleanups.push(cleanup) }, 'misjudge'); }, LONG);

test('#1334.14e4b3e9 a planted build that starts but judges the fixture claim wrongly is rolled back the same way; a health check that only pings the hub passes this plant and fails, naming the claim (redraft 1865)', LONG, (t) => {
  t.diagnostic(rolledBack(scene, '#1334.14e4b3e9',
    `the planted build (DEEP_HUB_PLANT=${MISJUDGES}) starts and answers, so a health check that only pings the hub passes it. The fixture claim, judged by this build's gate, reads the opposite of what it should, and the health check must judge it`));
});
