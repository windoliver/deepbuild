// #2330: a connection accepted after confirmation is not an absent hub when it closes without hello.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { hubCommand } from '@deepbuild/hub/hub';

it('installed stop refuses success if the listener accepts but closes before its hello', async () => {
  const home = mkdtempSync('/tmp/stop-probe-'), root = join(home, '.deepbuild');
  mkdirSync(root); writeFileSync(join(root, 'control.token'), 'probe-only\n');
  let connections = 0;
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket));
    if (++connections > 1) { socket.end(); return; }
    socket.write('{"hello":"deep-hub","contract":"1.0","features":[],"generation":1}\n');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      for (let i; (i = buffer.indexOf('\n')) >= 0;) {
        const message = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1);
        if (message.hello) socket.write('{"role":"cli"}\n');
        else { expect(message.method).toBe('you.confirm'); socket.write(`${JSON.stringify({ id: message.id, result: {} })}\n`); }
      }
    });
  });
  await new Promise<void>((done) => server.listen(join(root, 'hub.sock'), done));
  const printed: string[] = [];
  vi.stubEnv('HOME', home);
  const out = vi.spyOn(process.stdout, 'write').mockImplementation((s) => { printed.push(String(s)); return true; });
  const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    expect(await hubCommand(['stop'], ''), 'accepted-without-hello is not absent').toBe(3);
    expect(connections).toBeGreaterThan(1);
    expect(server.listening).toBe(true);
    expect(printed).toEqual([]);
    expect(readFileSync(join(root, 'control.token'), 'utf8')).toBe('probe-only\n');
  } finally {
    for (const socket of sockets) socket.destroy();
    server.close(); out.mockRestore(); err.mockRestore(); vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  }
}, 10_000);
