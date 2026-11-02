// The Scope line: a resume on a shared task skips a session you paused or stopped, one whose attempt was replaced,
// and one whose task closed, and records why.

import { test } from 'vitest';
import { resumeSkips } from './scenarios.ts';

test('(Scope) a resume on a shared task skips a session you stopped, one whose attempt was replaced and one whose task closed, resumes the rest, and records why it skipped each', async () => {
  await resumeSkips();
}, 30_000);
