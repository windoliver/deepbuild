// A saved approval of an MCP tool lapses when its schema changes (#321, Scope), and the update's ask shows the
// server's hints as its own claims. Real record, real asks core, and a fake stdio MCP server (a boundary we don't
// own: #321's suite's fixture), declared in a temp HOME's Claude Code config as Claude Code would load it.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { openAsks } from '@deepbuild/asks';
import { openRecord, type Connection } from '@deepbuild/record';
import { Holds } from '../src/holds.js';
import type { HookMeta } from '../src/wire.js';

const SERVER = fileURLToPath(new URL('../../../tests/acceptance/321/fixtures/mcp-server.mjs', import.meta.url));
const home = process.env.HOME;
let dir = '';
afterEach(() => {
  process.env.HOME = home;
  rmSync(dir, { recursive: true, force: true });
});

const tool = (name: string, schema: object, annotations?: object) => ({ name, description: name, inputSchema: schema, ...(annotations ? { annotations } : {}) });
const BY_NAME = { type: 'object', properties: { repo: { type: 'string' } } };
const BY_ID = { type: 'object', properties: { id: { type: 'integer' } } };

describe('a saved approval of an MCP tool', () => {
  it('covers the tool at the schema you approved, and lapses once its schema changes', async () => {
    dir = mkdtempSync(join(tmpdir(), 'holds-'));
    process.env.HOME = dir;
    const cwd = join(dir, 'repo');
    const root = join(dir, '.deepbuild');
    mkdirSync(cwd);
    mkdirSync(root);
    writeFileSync(join(root, 'config.json'), JSON.stringify({ asks: { deadline: { authority: '1d' }, default: { authority: 'no' } } }));
    const tools = join(dir, 'tools.json');
    const update = (list: object[], version: string) => writeFileSync(tools, JSON.stringify({ version, tools: list }));
    update([tool('list_issues', BY_NAME, { readOnlyHint: true })], '1.0.0');
    writeFileSync(join(dir, '.claude.json'), JSON.stringify({ mcpServers: { forge: { type: 'stdio', command: process.execPath, args: [SERVER, 'forge', tools, join(dir, 'log.jsonl')] } } }));

    let t = 1_760_000_000_000;
    const now = () => (t += 1000);
    const record = await openRecord({ path: join(dir, 'record.db'), now });
    const asks = await openAsks({ record, now, deliver: () => undefined, home: root });
    const as = (writer: string, session?: string): Connection => ({ writer, actor: 'you', scope: 'you', ...(session ? { session, agent: 'claude-code' } : {}) });
    const holds = new Holds({
      raw: (q) => record.raw(q), asks: () => asks, now, plant: undefined, sorter: undefined,
      append: async (c, e) => { await record.append(c, e); }, connection: (s) => as('core', s), pin: async () => ({ kind: 'commit', ref: '0'.repeat(40) }),
    });
    const call = (session: string) => holds.gate({ session, agent: 'claude-code', cwd } as HookMeta, { label: 'forge delete_repo', classes: [], mcp: { server: 'forge', tool: 'delete_repo' } });

    await holds.listed('s1', 'claude-code', cwd);
    update([tool('list_issues', BY_NAME, { readOnlyHint: true }), tool('delete_repo', BY_NAME, { readOnlyHint: true })], '1.1.0');
    await holds.listed('s2', 'claude-code', cwd);
    const [first] = (await record.raw("SELECT id, question FROM asks WHERE kind = 'authority'")) as { id: string; question: string }[];
    expect(first?.question, "the update's ask names the tool and shows its hints as the server's own claims").toMatch(/delete_repo.*The server says, as its own claims: delete_repo: \{"readOnlyHint":true\}/);
    expect(await call('s2'), 'held until you answer').toContain(`ask:${first!.id}`);
    await asks.answer(as('cli'), `ask:${first!.id}`, { option: 'approve', token: 'click' });
    expect(await call('s2'), 'your yes covers the tool at the schema you approved').toBeUndefined();

    update([tool('list_issues', BY_NAME, { readOnlyHint: true }), tool('delete_repo', BY_ID, { readOnlyHint: true })], '1.2.0');
    await holds.listed('s3', 'claude-code', cwd);
    const held = await call('s3');
    const second = ((await record.raw("SELECT id FROM asks WHERE kind = 'authority' ORDER BY created")) as { id: string }[])[1];
    expect(second, 'the changed schema raises a new ask for the update').toBeDefined();
    expect(held, 'with its schema changed, the approval has lapsed: the call waits on the new ask').toContain(`ask:${second!.id}`);
    await record.close();
  }, 60_000);
});
