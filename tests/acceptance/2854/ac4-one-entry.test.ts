// #2854 AC4: "`deep mcp` and deep-hook read the held list from one contract entry, and the reading tools' copy equals
// it. A planted reading tools file whose list lacks the newest revision fails, naming the file"
//
// The issue's "Where the list, the facts and the check live" names the entry: packages/contracts/schemas/
// mcp.handshake@1.json, an object whose `protocolVersion` is a string with an `enum` of the held revisions, oldest
// first, ["2025-06-18", "2025-11-25"], the newest the last; generated as the `McpHandshake` type in
// packages/contracts/src/generated/types.ts and the `McpHandshakeProtocolVersion` enum in
// crates/deep-contracts/src/generated.rs. `deep mcp` and deep-hook read it: the two files the issue names for their
// initialize (packages/hub/src/mcp.ts, crates/deep-hook/src/actions.rs) hold no revision as a quoted literal, and each
// answers a revision it doesn't hold with the entry's newest. The reading tools' copy is the quoted revisions in
// packages/reading/src/tools.mts, equal to the entry's. The plant is in the test: that file with the newest revision
// taken out, through the same comparison, which names the file.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, copyFailure, ENTRY, GENERATED_RS, GENERATED_TS, handshake, HELD, heldList, quotedRevisions, READING_SOURCE, root, scratch, SERVER_SOURCES, SERVERS, UNKNOWN,
} from './helpers.ts';

describe(`${AC.oneEntry} one contract entry holds the list`, () => {
  it(`${AC.oneEntry} mcp.handshake@1's protocolVersion enum is 2025-06-18, 2025-11-25, generated as McpHandshake and McpHandshakeProtocolVersion; deep mcp and deep-hook hold no copy of their own and answer an unknown revision with its newest; the reading tools' copy equals it, and a planted reading tools file lacking the newest fails naming the file`, async () => {
    const { revisions, failure } = heldList();
    expect(failure, `the contract entry ${ENTRY}`).toBeUndefined();
    expect(revisions, `${ENTRY}'s protocolVersion enum, oldest first`).toEqual([...HELD]);
    const entry = revisions!;
    const newest = entry.at(-1)!;

    const generated = [
      { file: 'packages/contracts/src/generated/types.ts', text: readFileSync(GENERATED_TS, 'utf8'), name: 'McpHandshake' },
      { file: 'crates/deep-contracts/src/generated.rs', text: readFileSync(GENERATED_RS, 'utf8'), name: 'McpHandshakeProtocolVersion' },
    ];
    for (const { file, text, name } of generated) {
      expect(new RegExp(`\\b${name}\\b`).test(text), `${file} holds the generated ${name}`).toBe(true);
      expect(entry.filter((r) => !text.includes(r)), `${file} holds each revision of ${ENTRY}`).toEqual([]);
    }

    // deep mcp and deep-hook read the entry: the two files the issue names for their initialize hold no copy of a
    // revision of their own (the hub's MCP client to other servers, mcp-servers.ts, is not a server and isn't read).
    const own = SERVER_SOURCES
      .flatMap((file) => quotedRevisions(readFileSync(join(root, file), 'utf8')).map((r) => `${file} holds ${r} as a literal of its own`));
    expect(own, 'deep mcp\'s and deep-hook\'s sources hold no handshake revision of their own').toEqual([]);
    for (const server of [SERVERS[0]!, SERVERS[2]!]) {
      const { answered, mcp } = await handshake(server, UNKNOWN, scratch());
      mcp.stop();
      expect(answered, `${server.label} answers initialize naming ${UNKNOWN} with ${ENTRY}'s newest`).toBe(newest);
    }

    // The reading tools' copy, and the planted file.
    const text = readFileSync(join(root, READING_SOURCE), 'utf8');
    expect(copyFailure(READING_SOURCE, text, entry), 'the reading tools\' copy equals the entry').toBeUndefined();
    const planted = text.split(newest).join('');
    const plantFailure = copyFailure(READING_SOURCE, planted, entry);
    expect(plantFailure, 'the planted reading tools file lacking the newest revision fails').toBeDefined();
    expect(plantFailure, 'the failure names the file and the revision it lacks').toMatch(new RegExp(`^${READING_SOURCE.replace(/\./g, '\\.')}: .*lacks ${newest}`));
  }, 300_000);
});
