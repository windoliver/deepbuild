// #1906 no-visible-change: one OS liveness probe, with each caller retaining its existing unknown-result policy.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import { openAsks } from '@deepbuild/asks';
import { openRecord } from '@deepbuild/record';
import { alive, openSupervisor } from '@deepbuild/supervisor';
import { openExtensionHost, openTrust } from '../src/index.js';

const root = mkdtempSync(join(tmpdir(), 'live-1906-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

it.each([
  [undefined, true, false], ['EPERM', true, false], ['ESRCH', false, true], ['EINVAL', true, true], ['EACCES', true, true],
] as const)('keeps supervisor and terminal results for OS error %s', async (code, supervisorAlive, terminalEnded) => {
  const home = join(root, code ?? 'alive');
  mkdirSync(join(home, 'extensions'), { recursive: true });
  const terminal = 'term:CASE1906';
  const pid = 2147483000;
  writeFileSync(join(home, 'extensions', 'terminals.json'), JSON.stringify({ [terminal]: { terminal, id: 'hub', run: 'run:CASE1906', pid, title: 'retained', kept: true } }));
  const record = await openRecord({ path: join(home, 'record.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const supervisor = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 60_000 } } } });
  const host = await openExtensionHost({ home, record, supervisor, trust: await openTrust({ record, now: Date.now }), now: Date.now });
  const original = process.kill;
  const probe = vi.spyOn(process, 'kill').mockImplementation(((given: number, signal: NodeJS.Signals | number) => {
    if (given !== pid || signal !== 0) return original(given, signal);
    if (code) throw Object.assign(Error(code), { code });
    return true;
  }) as typeof process.kill);
  try {
    expect(alive(pid)).toBe(supervisorAlive);
    const tab = await host.tab({ writer: 'app', actor: 'you', scope: 'you' }, terminal);
    expect(tab.ended).toBe(terminalEnded);
    expect(tab.input).toBe(false);
    expect(tab.notice === null).toBe(terminalEnded);
  } finally {
    probe.mockRestore();
    await host.close();
    await supervisor.close();
    await record.close();
  }
});
