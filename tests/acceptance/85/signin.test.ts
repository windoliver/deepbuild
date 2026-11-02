// Criterion 1: a revoked sign-in that stopped five sessions shows as one task and resumes all five after /login.

import { test } from 'vitest';
import { STOPS } from './helpers.ts';
import { sharedTask } from './scenarios.ts';

test('#85.828d7241 a revoked sign-in that stopped five sessions shows as one task in your inbox and Needs you, and when /login makes its check pass all five resume, with nothing typed', async () => {
  await sharedTask(STOPS.signIn(), 'a revoked sign-in');
}, 30_000);
