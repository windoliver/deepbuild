// A service check that sends no request has nothing to show for the endpoint: it ran nothing, never a pass
// (AGENTS.md invariant 2). #68's suite always sends five.
import { describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { workFill, type ServiceSpec } from '../src/index.js';

const spec = (requests: number): ServiceSpec => ({
  kind: 'service', runner: 'http', inputs: [], depth: 'integration', oracle: 'code', contract: null,
  // Nothing listens on the discard port, so a request sent would fail the run, never pass it.
  url: 'http://127.0.0.1:9/orders/1042', from: '127.0.0.1', shape: { id: 'number' }, floor: { latency_ms: 1000, throughput_rps: 0 }, requests,
});

describe('a service check with no requests to send', () => {
  for (const requests of [0, -1]) {
    it(`ran nothing at requests: ${requests}`, async () => {
      const r = await workFill('service').run(spec(requests), { checkout: tmpdir(), deadline: 10_000, now: () => Date.now() });
      expect([r.outcome, r.testsRun], JSON.stringify(r)).toEqual(['ran_nothing', 0]);
    });
  }
});
