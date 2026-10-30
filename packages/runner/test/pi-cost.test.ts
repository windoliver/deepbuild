// A pi job's cost, as pi's own output says it: charged, so its reservation doesn't stay held. pi here is a script
// printing what real pi prints in --mode json, which needs no pi installed.
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { openRecord } from '@deepbuild/record';
import { openAsks } from '@deepbuild/asks';
import { openLedger } from '@deepbuild/budget';
import { openSupervisor } from '@deepbuild/supervisor';
import { openRunner } from '../src/index.js';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); }, 30_000);
const DAY = 86_400_000;

it('a pi job records the cost its messages report, each message once', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'pi-cost-'));
  const [home, bin] = [join(tmp, 'h'), join(tmp, 'bin')];
  mkdirSync(home);
  mkdirSync(bin);
  const message = (total: number) => JSON.stringify({ type: 'message_end', message: { role: 'assistant', model: 'm', stopReason: 'stop', content: [{ type: 'text', text: 'done' }], usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: { total } } } });
  const out = [JSON.stringify({ type: 'session', id: 'session-1' }), message(0.25), message(0.5), JSON.stringify({ type: 'agent_settled' })];
  writeFileSync(join(bin, 'pi'), `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 1.4.0; exit 0; fi\nprintf '%s\\n' ${out.map((one) => `'${one}'`).join(' ')}\n`);
  chmodSync(join(bin, 'pi'), 0o755);
  const record = await openRecord({ path: join(tmp, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const ledger = await openLedger({ record, asks, now: Date.now, price: async () => 0.5 });
  const supervisor = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 2 * DAY } } }, resources: [] });
  const runner = await openRunner({
    record, asks, supervisor, ledger, now: Date.now, root: join(home, '.deepbuild'), loginPath: `${bin}:/usr/bin:/bin`,
    env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` },
    settings: { plan: { reserve_pct: 10 }, asks: { unblock: { deadline_ms: 2 * DAY } } },
  });
  closers.push(async () => { await runner.close(); await supervisor.close(); await record.close(); rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); });
  const rec = await runner.run({ kind: 'read', agent: 'pi' as never, prompt: 'hi', deadline_ms: 30_000, grant: { read: [tmp] } });
  expect({ state: rec.state, blocked: rec.blocked, refused: rec.refused }).toEqual({ state: 'finished', blocked: undefined, refused: undefined });
  expect(rec.cost_usd).toBe(0.75);
}, 60_000);
