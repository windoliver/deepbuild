// #1906: folding the listener probe must not turn an unreadable answer into a free port.
// lsof is the OS boundary; binding and probing the chosen port still use real sockets.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import { expect, it, vi } from 'vitest';
import { portKind } from '../src/index.js';

it('nonempty lsof output without a PID proves no port free', async () => {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen({ port: 0, host: '127.0.0.1' }, resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const original = childProcess.execFile;
  const probe = vi.spyOn(childProcess, 'execFile').mockImplementation(((...args: unknown[]) => {
    if (String(args[0]).endsWith('/lsof')) {
      const callback = args.at(-1) as (error: null, stdout: string, stderr: string) => void;
      queueMicrotask(() => callback(null, 'unreadable listener\n', ''));
      return {};
    }
    return Reflect.apply(original, childProcess, args);
  }) as typeof childProcess.execFile);
  syncBuiltinESMExports();
  try {
    expect(await portKind().free!(String(port))).toBe(false);
    expect(probe).toHaveBeenCalled();
  } finally {
    probe.mockRestore();
    syncBuiltinESMExports();
  }
});
