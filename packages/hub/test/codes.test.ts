// The kit behind deep://codes/<code> (#26): each page's planted call, made against a live hub, raises the page's code,
// and its clean twin doesn't, so no page can drift from what the hub does. Every page's code is one error@2 lists.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getSchema } from '@deepbuild/contracts';
import { CODES, type CodeCall } from '../src/codes.js';
import { ulid } from '../src/wire.js';
import { hookLine, mcp, send, withHub } from './hub.js';

type Obj = Record<string, any>;

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
