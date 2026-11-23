// #2854 AC1: "Each of the four servers answers `initialize` naming `2025-06-18` with `2025-06-18`, and naming
// `2025-11-25` with `2025-11-25`. Naming `1900-01-01`, naming `2026-07-28`, and with no `protocolVersion`, each answers
// `2025-11-25`. On the merge base each answers `1900-01-01` and `2026-07-28` as sent, and this test fails, naming the
// server and the version"
//
// Each handshake is a fresh process of the server (initialize is a session's first request), driven over its stdio by
// raw JSON-RPC lines. Every failure line names the server and the version it was sent.
import { describe, expect, it } from 'vitest';
import { AC, HANDSHAKES, handshake, named, scratch, SERVERS } from './helpers.ts';

describe(`${AC.answers} initialize is answered from the held list`, () => {
  for (const server of SERVERS) {
    it(`${AC.answers} ${server.label} answers initialize naming 2025-06-18 with 2025-06-18 and naming 2025-11-25 with 2025-11-25; naming 1900-01-01, naming 2026-07-28 and with no protocolVersion it answers 2025-11-25`, async () => {
      const home = scratch();
      const failures: string[] = [];
      for (const { sent, answered: want } of HANDSHAKES) {
        const { answered, mcp } = await handshake(server, sent, home);
        mcp.stop();
        if (answered !== want) failures.push(`${server.label}: initialize naming ${named(sent)} is answered ${JSON.stringify(answered)}, not ${want}`);
      }
      expect(failures, `${server.label}'s answers to the five handshakes`).toEqual([]);
    }, 300_000);
  }
});
