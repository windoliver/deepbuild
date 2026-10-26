// The kit behind deep://codes/<code> (#26): each page's planted call, made against a live hub, raises the page's code,
// and its clean twin doesn't, so no page can drift from what the hub does. Every page's code is one error@2 lists.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getSchema } from '@deepbuild/contracts';
import { CODES, type CodeCall } from '../src/codes.js';
import { ulid } from '../src/wire.js';
import { hookLine, send, withHub } from './hub.js';

const CLI = fileURLToPath(new URL('../../cli/dist/main.js', import.meta.url));
type Obj = Record<string, any>;

/** A deep mcp in `cwd`: this process's own child, or, `unbound`, a grandchild under a shell no session's hooks came from. */
function mcp(home: string, cwd: string, unbound: boolean) {
  const argv = [process.execPath, CLI, 'mcp'];
  // The shell runs one more command after node, so it doesn't exec node in its place.
  const child = unbound
    ? spawn('/bin/sh', ['-c', `"${argv.join('" "')}"; :`], { cwd, env: { ...process.env, HOME: home }, stdio: ['pipe', 'pipe', 'inherit'] })
    : spawn(argv[0]!, argv.slice(1), { cwd, env: { ...process.env, HOME: home }, stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting = new Map<number, (m: Obj) => void>();
  createInterface({ input: child.stdout }).on('line', (raw) => { const m = JSON.parse(raw) as Obj; waiting.get(m.id)?.(m); waiting.delete(m.id); });
  let ids = 0;
  const request = (method: string, params: Obj) => new Promise<Obj>((resolve) => { const id = ++ids; waiting.set(id, resolve); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  return {
    request,
    async call(tool: string, args: Obj): Promise<{ isError: boolean; value: Obj }> {
      const reply = await request('tools/call', { name: tool, arguments: args });
      return { isError: reply.result?.isError === true, value: JSON.parse(reply.result?.content?.[0]?.text ?? 'null') as Obj };
    },
    close: () => child.stdin.end(),
  };
}

describe('deep://codes/<code>', () => {
  it('names only codes error@2 lists, and each page reads with no tool call', async () => {
    const codes = (getSchema('error@2') as Obj).properties.code.enum as string[];
    expect(CODES.map((p) => p.code).filter((c) => !codes.includes(c))).toEqual([]);
    const home = realpathSync(mkdtempSync('/tmp/codes-26-'));
    try {
      const reader = mcp(home, home, false);
      await reader.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'kit', version: '0' } });
      for (const page of CODES) {
        const read = await reader.request('resources/read', { uri: `deep://codes/${page.code}` });
        expect(JSON.parse(read.result.contents[0].text)).toEqual(page);
      }
      reader.close();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('each page\'s planted call raises its code alone, and its clean twin does not', async () => {
    await withHub(async (root, home) => {
      // The kit's fixture: a session whose spec names unit, with real.txt in its folder and a claim made.
      const work = join(home, 'work');
      mkdirSync(join(work, '.deepbuild'), { recursive: true });
      writeFileSync(join(work, '.deepbuild', 'done.yaml'), 'checks:\n  unit: { type: command, run: "true" }\n');
      writeFileSync(join(work, 'real.txt'), 'real');
      const session = '5b0c2f1e-7a51-4c3e-9d5e-0f6a8b2c4d10';
      const transcript = join(home, '.claude', 'projects', 'work', `${session}.jsonl`);
      mkdirSync(join(home, '.claude', 'projects', 'work'), { recursive: true });
      writeFileSync(transcript, '');
      for (const event of ['SessionStart', 'UserPromptSubmit']) {
        const payload = { session_id: session, transcript_path: transcript, cwd: work, hook_event_name: event, ...(event === 'UserPromptSubmit' ? { prompt: 'fix it' } : {}) };
        expect(await send(join(root, 'hub.sock'), hookLine(ulid(Date.now()), event, payload, { ppid: process.pid }))).toContain('"ack"');
      }
      const own = mcp(home, work, false);
      const hand = mcp(home, work, true);
      const nowhere = realpathSync(mkdtempSync('/tmp/codes-26-down-'));
      const down = mcp(nowhere, work, false);
      for (const m of [own, hand, down]) await m.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'kit', version: '0' } });
      try {
        const claimed = await own.call('deep_claim', { task_ref: `task:${ulid(Date.now())}`, attempt: 1, commit: '0c5e145756bbdaef4d9b8bdaca2d0bd0f900ed46', scope: 'session', predictions: null });
        expect(claimed.isError, JSON.stringify(claimed.value)).toBe(false);
        const make = (c: CodeCall) => (c.hub === 'stopped' ? down : c.from === 'unbound' ? hand : own).call(c.tool, c.arguments);
        for (const page of CODES) {
          const planted = await make(page.planted);
          expect({ code: page.code, raised: planted.isError ? planted.value.code : 'nothing' }).toEqual({ code: page.code, raised: page.code });
          const clean = await make(page.clean);
          expect({ code: page.code, twin: clean.isError ? clean.value.code : 'nothing' }).not.toEqual({ code: page.code, twin: page.code });
        }
      } finally {
        for (const m of [own, hand, down]) m.close();
        rmSync(nowhere, { recursive: true, force: true });
      }
    });
  }, 60_000);
});
