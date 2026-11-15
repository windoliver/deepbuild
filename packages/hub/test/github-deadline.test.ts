// #2068: the single read deadline covers credentials and response bodies, not only HTTP headers.
import { execFile } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { liveFetch } from '../src/github-source.js';

it('cancels the real gh token child at the caller deadline without reading credentials', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'issue-token-'));
  // A fake executable is the external credential boundary, not a mock of child_process or the deadline.
  writeFileSync(join(dir, 'gh'), `#!${process.execPath}\nsetTimeout(() => process.stdout.write('fixture-not-a-credential'), 2000);\n`);
  chmodSync(join(dir, 'gh'), 0o700);
  const module = fileURLToPath(new URL('../dist/hub-shared.js', import.meta.url));
  const script = `import { pathToFileURL } from 'node:url'; const { ghToken } = await import(pathToFileURL(${JSON.stringify(module)}));
    const started = performance.now(); const token = await ghToken(AbortSignal.timeout(100));
    console.log(JSON.stringify({ missing: token === undefined, elapsed: performance.now() - started }));`;
  try {
    const output = await new Promise<string>((resolve, reject) => execFile(process.execPath, ['--input-type=module', '-e', script], {
      // ownHome must hold for this branch. PATH names ONLY our fake gh; no token, config or shell is inherited.
      env: { HOME: userInfo().homedir, PATH: dir }, timeout: 10_000,
    }, (error, stdout) => error ? reject(error) : resolve(stdout)));
    const result = JSON.parse(output.trim()) as { missing: boolean; elapsed: number };
    expect(result.missing, 'the caller deadline must abort credential acquisition rather than read its late answer').toBe(true);
    expect(result.elapsed, 'credentials must not retain their own five-second wait after the caller deadline').toBeLessThan(1000);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 15_000);

it('cancels an unfinished JSON body with the same signal that reached the headers', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.flushHeaders();
    response.write('{');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('no fixture address');
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    const done = liveFetch(`http://127.0.0.1:${address.port}`, undefined, AbortSignal.timeout(100))('/issue', 1);
    const result = await Promise.race([done, new Promise<undefined>((resolve) => { watchdog = setTimeout(resolve, 1000); })]);
    expect(result, 'stalled response-body wait must end at the caller deadline, not its per-request 20 s timeout').toBeDefined();
    expect(result?.body, 'a truncated body never supplies issue data').toBeUndefined();
  } finally {
    clearTimeout(watchdog);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
