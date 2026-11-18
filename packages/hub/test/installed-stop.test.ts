// #2330: the installed CLI must not announce success when its stop acknowledgement never becomes shutdown.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { hubCommand } from '@deepbuild/hub/hub';

const realTimer = setTimeout;
const realWait = (ms: number) => new Promise<void>((done) => realTimer(done, ms));

it('installed hub stop returns 3 without a stopped message while its peer keeps answering', async () => {
  const home = mkdtempSync('/tmp/installed-stop-'), root = join(home, '.deepbuild');
  mkdirSync(root);
  writeFileSync(join(root, 'control.token'), 'installed-stop-only\n');
  const sockets = new Set<net.Socket>(), calls: string[] = [];
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    socket.write('{"v":1,"hello":"deep-hub","contract":"1.0","features":[],"generation":1}\n');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      for (let i; (i = buffer.indexOf('\n')) >= 0;) {
        const message = JSON.parse(buffer.slice(0, i)) as { hello?: string; method?: string; id?: unknown };
        buffer = buffer.slice(i + 1);
        if (message.hello) socket.write('{"role":"cli"}\n');
        else {
          calls.push(message.method!);
          socket.write(`${JSON.stringify({ id: message.id, result: {} })}\n`);
        }
      }
    });
  });
  await new Promise<void>((done) => server.listen(join(root, 'hub.sock'), done));
  const printed: string[] = [];
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((value) => { printed.push(String(value)); return true; });
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  vi.stubEnv('HOME', home);
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  let work: Promise<number> | undefined;
  try {
    work = hubCommand(['stop'], '');
    for (let i = 0; i < 500 && !calls.includes('hub.stop'); i++) await realWait(10);
    expect(calls, 'real confirmation exchange precedes the stop').toEqual(['you.confirm', 'hub.stop']);
    await realWait(20);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await work, 'a live hub is not successfully stopped').toBe(3);
    expect(printed, 'do not say The hub stopped').toEqual([]);
  } finally {
    for (const socket of sockets) socket.destroy();
    server.close();
    await vi.advanceTimersByTimeAsync(20_000);
    if (work) await work;
    vi.useRealTimers();
    stdout.mockRestore(); stderr.mockRestore(); vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  }
}, 20_000);
