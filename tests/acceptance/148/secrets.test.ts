// AC2 #148.55a38c24: A server's token appears in no config file, log or record row, by a test that searches for it,
// unless you approved writing it for an agent that can't start servers by command.
//
// Claude Code, Codex and pi all start servers by command, so the token may appear nowhere. The token is a fake made for
// this test, entered once with the server's spec (README: The surface, a server's spec), and the secret store stands in
// as a file outside HOME. The search covers every file under HOME (each agent's config and logs, and DeepBuild's root:
// ledger.db and its WAL, logs and evidence), every record row through events.read, and the hub's own output, in the
// value's raw, base64, base64url and hex forms. So that a sync can't pass by dropping the secret, the server, started by
// Claude Code's and pi's own list commands through `deep mcp-exec <name>`, must have received the token: it logs only
// the token's SHA-256, outside HOME.
import { describe, expect, it } from 'vitest';
import {
  AC, TOKEN_VARIABLE, approve, claudeList, codexList, events, fakeToken, filesHolding, formsOf, makeWorld, piList, propose, ranText, serverLog, sha256, shown, startHub, stdioServer, tag, useCleanup,
} from './helpers.ts';

useCleanup();

describe('#148 a server\'s secret', () => {
  it(`${AC[2]} a server's token, entered once, reaches the server through deep mcp-exec and appears in no file under HOME, no record row and no log`, async () => {
    const w = await makeWorld();
    const hub = await startHub(w);
    const token = fakeToken();
    const name = `forge-${tag()}`;
    await approve(w, await propose(w, { via: 'app', server: stdioServer(w, name, { token }), agents: ['claude-code', 'codex', 'pi'] }));

    // Each agent's entry runs `deep mcp-exec <name>`.
    const codex = await codexList(w);
    const entry = codex.servers.find((s) => s.name === name);
    expect(entry, `codex mcp list --json lists ${name}: ${ranText(codex.ran)}`).toBeDefined();
    const line = [entry!.transport?.command, ...(entry!.transport?.args ?? [])].join(' ');
    expect(line, `Codex's entry for ${name} runs deep mcp-exec ${name}: ${shown(entry)}`).toMatch(new RegExp(`mcp-exec ${name}(\\s|$)`));
    // Claude Code and pi start it, through deep mcp-exec, and it gets its token by handle.
    const claude = await claudeList(w);
    expect(claude.stdout, `claude mcp list connects to ${name}: ${ranText(claude)}`).toMatch(new RegExp(`^${name}: .*Connected`, 'm'));
    const pi = await piList(w);
    expect(pi.servers.find((s) => s.name === name)?.state, `pi mcp list --json connects to ${name}: ${ranText(pi.ran)}`).toBe('connected');
    const got = serverLog(w, name);
    expect(got.length, `the server ${name} was started`).toBeGreaterThan(0);
    expect(got.every((l) => l.token_sha256 === sha256(token)), `each start of ${name} had the token in ${TOKEN_VARIABLE}: ${shown(got)}`).toBe(true);

    // The search.
    const forms = formsOf(token);
    expect(filesHolding(w.home, forms), 'no file under HOME holds the token in any form').toEqual([]);
    const rows = JSON.stringify(await events(w));
    expect(forms.filter((f) => rows.includes(f)), 'no record row holds the token').toEqual([]);
    expect(forms.filter((f) => hub.stderr().includes(f)), 'the hub\'s own output doesn\'t hold the token').toEqual([]);
  });
});
