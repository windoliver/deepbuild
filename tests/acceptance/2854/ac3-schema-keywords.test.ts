// #2854 AC3: "Every tool's `inputSchema`, from each server's `tools/list`, uses only keywords that mean the same in JSON
// Schema 2020-12, the default from `2025-11-25`, and in draft-07. A planted tool whose schema gives `items` as a list
// of schemas fails, naming the tool and the keyword"
//
// The list is read in a session the server holds at 2025-11-25, the revision whose default dialect is 2020-12: the
// server first shows it holds a list (initialize naming 1900-01-01 is answered 2025-11-25, not sent back; README:
// Readings), then a fresh session's initialize naming 2025-11-25 is answered with it and its tools/list is checked.
// The check (helpers.ts, schemaFailures) walks every subschema and allows only the keywords both dialects define
// alike; anything else fails as `<tool>: <keyword> at <path>`. The plant is in the test: the server's own list with
// one more tool whose schema gives `items` as a list of schemas, through the same check.
import { describe, expect, it } from 'vitest';
import { AC, holdsAList, NEWEST, schemaFailures, scratch, SERVERS, toolsAt, type Tool } from './helpers.ts';

const PLANTED: Tool = {
  name: 'planted_tuple',
  description: 'A planted tool whose schema gives items as a list of schemas, a tuple in draft-07 and not in 2020-12.',
  inputSchema: { type: 'object', properties: { pair: { type: 'array', items: [{ type: 'string' }, { type: 'number' }] } }, required: ['pair'], additionalProperties: false },
};

describe(`${AC.keywords} every tool's inputSchema means the same in 2020-12 and draft-07`, () => {
  for (const server of SERVERS) {
    it(`${AC.keywords} ${server.label}: every tool's inputSchema in tools/list at 2025-11-25 uses only keywords that mean the same in 2020-12 and draft-07; the list with a planted tool giving items as a list of schemas fails, naming the tool and the keyword`, async () => {
      const home = scratch();
      const held = await holdsAList(server, home);
      expect(held, `${server.label} holds a list of handshake revisions`).toBeUndefined();
      const { answered, tools } = await toolsAt(server, NEWEST, home);
      expect(answered, `${server.label} answers initialize naming ${NEWEST} with it`).toBe(NEWEST);
      expect(tools?.length, `${server.label} lists tools`).toBeGreaterThan(0);
      expect(tools!.flatMap(schemaFailures), `${server.label}'s tools' schemas`).toEqual([]);
      const planted = [...tools!, PLANTED].flatMap(schemaFailures);
      expect(planted.length, `the planted tool fails the check in ${server.label}'s list`).toBeGreaterThan(0);
      expect(planted.every((line) => line.startsWith(`${PLANTED.name}: items`)), `each failure names the planted tool and items: ${JSON.stringify(planted)}`).toBe(true);
    }, 300_000);
  }
});
