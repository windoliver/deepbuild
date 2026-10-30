// A saved approval of an MCP tool lapses when its schema changes (#321, Scope), and the update's ask shows the
// server's hints as its own claims. Real record, real asks core, and a fake stdio MCP server (a boundary we don't
// own: #321's suite's fixture), declared in a temp HOME's Claude Code config as Claude Code would load it.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { openAsks } from '@deepbuild/asks';
import { openRecord, ulid, type Connection } from '@deepbuild/record';
import { Holds } from '../src/holds.js';
import type { HookMeta } from '../src/wire.js';
import { hookLine, reply, withHub } from './hub.js';

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
    await asks.answer(as('cli'), `ask:${first!.id}`, { option: 'approve', plan_hash: (await asks.card(`ask:${first!.id}`)).plan!.hash, token: 'click' });
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

describe('a call that needs your authority in the turn a proceed starts', () => {
  it('is held with an authority ask even when a warn entry also matches it; a block entry denies it with no ask', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'holds-warn-'));
    const sorter = join(dir, 'sorter.json');
    writeFileSync(sorter, JSON.stringify({ rule: 'planted-proceed', proceed: ['want me to push to main?'] }));
    try {
      await withHub(async (root) => {
        writeFileSync(join(root, 'config.json'), JSON.stringify({ asks: { deadline: { authority: '1d' }, default: { authority: 'no' } } }));
        const guard = (match: string, mode: string) => ({ match, scope: 'all_repos', mode, reason: `${mode}s.`, next_step: 'Go on.', fail_closed: false });
        writeFileSync(join(root, 'rules.json'), JSON.stringify({ v: 1, entries: { 'yours-push': guard('run:git push', 'warn'), 'no-push': guard('run:git push', 'block'), 'authority-push': guard('effect:push', 'watch') } }));
        const socket = join(root, 'hub.sock');
        let t = Date.now();
        const base = { session_id: 's1', cwd: dir, transcript_path: join(dir, 't.jsonl') };
        const push = { ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git push origin main' } };
        // With no proceed, the gate lets the push go, and the warn entry's words still reach the agent.
        const free = await reply(socket, hookLine(ulid(++t), 'PreToolUse', { ...push, tool_use_id: 't0' }, { matched: ['yours-push', 'authority-push'] }));
        expect(free.exit, `no proceed, no hold: ${free.stderr}`).toBe(0);
        expect(free.stdout).toContain('DeepBuild warns: warns. Go on. (guard yours-push)');
        await reply(socket, hookLine(ulid(++t), 'Stop', { ...base, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'want me to push to main?' }));
        const watched = await reply(socket, hookLine(ulid(++t), 'PreToolUse', { ...push, tool_use_id: 't1' }, { matched: ['authority-push'] }));
        expect(watched.exit, `the push alone is held: ${watched.stderr}`).toBe(2);
        expect(watched.stderr).toMatch(/ask:/);
        const warned = await reply(socket, hookLine(ulid(++t), 'PreToolUse', { ...push, tool_use_id: 't2' }, { matched: ['yours-push', 'authority-push'] }));
        expect(warned.exit, `a warn entry matching the push too lets nothing through: ${warned.stdout}${warned.stderr}`).toBe(2);
        expect(warned.stderr).toMatch(/ask:/);
        // A block entry denies it outright: no ask your yes couldn't settle.
        const denied = await reply(socket, hookLine(ulid(++t), 'PreToolUse', { ...push, tool_use_id: 't3', tool_input: { command: 'git push origin dev' } }, { matched: ['no-push', 'authority-push'] }));
        expect(denied.exit).toBe(2);
        expect(denied.stderr).toContain('DeepBuild blocked this: blocks. Go on. (guard no-push)');
        expect(denied.stderr).not.toMatch(/ask:/);
      }, { DEEP_HUB_TEST_SORTER: sorter });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
