// AC5: the canvas's claims projection still reads {turn, did_work} from either version.
// The base has no claims projection code; what it names is the catalogue's binding (agent.stop feeds
// `claims`, canvas-primitives.md:562 with the columns {turn, did_work}) and the generated types a
// projection reads through. See README.md, Readings.
import { describe, expect, it } from 'vitest';
import { catalogue, checkViewBindings, decode, fixtures } from '../../../packages/contracts/src/index.ts';
import { CAUSES, expectPublished, expectRefused, stop, stopData, typecheck, USAGE_REPORTED, V1, V2 } from './helpers.ts';
import type { JsonObject } from './helpers.ts';

describe('AC5 the claims projection reads {turn, did_work} from agent.stop@1 and @2', () => {
  it('AC5 both versions are catalogued as feeding claims, and a view bound to agent.stop is accepted', () => {
    const feeds = Object.fromEntries(catalogue().filter((e) => e.kind === 'agent.stop').map((e) => [e.schema, e.feeds]));
    expect(feeds[V1] ?? [], `${V1} is catalogued; it feeds`).toContain('claims');
    expect(feeds[V2] ?? [], `${V2} is catalogued; it feeds`).toContain('claims');
    expect(checkViewBindings(['agent.stop'])).toEqual({ ok: true });
  });

  it('AC5 a stop of either version decodes with the same turn and did_work', () => {
    expectPublished(V2);
    const [v1] = fixtures(V1) as JsonObject[];
    const reading = (name: string, value: JsonObject) => {
      const event = decode<{ data: { turn: number; did_work: boolean } }>(name, JSON.stringify(value));
      return { turn: event.data.turn, did_work: event.data.did_work };
    };
    const want = reading(V1, v1!);
    for (const cause of CAUSES) {
      for (const usage of [null, USAGE_REPORTED]) {
        const data = { ...stopData(cause, usage), turn: want.turn, did_work: want.did_work };
        expect(reading(V2, stop(data)), `cause ${cause}, usage ${usage === null ? 'null' : 'captured'}`).toEqual(want);
      }
    }
  });

  it('AC5 agent.stop@2 requires turn and did_work under every cause', () => {
    for (const cause of CAUSES) {
      for (const key of ['turn', 'did_work']) {
        const data = stopData(cause);
        delete data[key];
        expectRefused(V2, stop(data), `/data/${key}`, `cause ${cause} without ${key}`);
      }
      expectRefused(V2, stop({ ...stopData(cause), did_work: 'yes' }), '/data/did_work', `cause ${cause}, did_work not a boolean`);
      expectRefused(V2, stop({ ...stopData(cause), turn: -1 }), '/data/turn', `cause ${cause}, turn below 0`);
    }
  });

  it('AC5 one projection function reads turn and did_work from the generated types of both versions', () => {
    const diagnostics = typecheck(`
export function claimsRow(event: {{V1}} | {{V2}}): { turn: number; did_work: boolean } {
  return { turn: event.data.turn, did_work: event.data.did_work };
}
`);
    expect(diagnostics, 'tsc over a projection of AgentStop | its version 2').toEqual([]);
  }, 60_000);
});
