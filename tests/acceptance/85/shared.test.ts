// Criteria 8 and 9: sessions stopped by a network you must reconnect (a VPN), or by a spend limit, share one task
// and resume within 30 s of its check passing, without you typing.

import { test } from 'vitest';
import { STOPS } from './helpers.ts';
import { sharedTask } from './scenarios.ts';

test('#85.0fa0b6d4 five sessions stopped by a VPN you must reconnect share one task, and resume within 30 s of its check passing, without you typing', async () => {
  await sharedTask(STOPS.vpn(), 'a VPN you must reconnect');
}, 30_000);

test('#85.243cc63a five sessions stopped by a spend limit share one task, and resume within 30 s of its check passing, without you typing', async () => {
  await sharedTask(STOPS.spend(), 'a spend limit');
}, 30_000);
