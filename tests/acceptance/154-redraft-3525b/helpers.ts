// The #154 redraft suite's helpers (../154-redraft/helpers.ts), unchanged, with the take's fetch moved to where #3525
// puts it: `deep_job {op: "fetch", pack, asset}` in place of `deep_kinds {op: "fetch", pack, asset}`, the same fields
// and the same replies (`held` with an ask, `fetched` with the asset, `refused`, BLOCKED). `fetchTake` and
// `scoreWorld` here shadow the originals; `fetchLibrary` and `control` (the cli socket call for `pack.rule`) are the
// originals' line for line, since the original module doesn't export them. Everything else is the original module's.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { expect } from 'vitest';
import {
  holds, installLibrary, installScore, openWorld, ref, sha256, show, sleep, type Library, type Line, type Outcome, type World,
} from '../154-redraft/helpers.ts';

export * from '../154-redraft/helpers.ts';

const parse = (text: string): Line | undefined => { try { const v: unknown = JSON.parse(text); return typeof v === 'object' && v !== null ? (v as Line) : undefined; } catch { return undefined; } };
/** One call on the hub's socket as the cli role, with the control token and this process for the peer check: the reply line. */
async function control(w: World, method: string, params: Line, timeoutMs = 120_000): Promise<Line> {
  const token = readFileSync(join(w.hub.root, 'control.token'), 'utf8').trim();
  const start = execFileSync('ps', ['-o', 'lstart=', '-p', String(process.pid)], { env: { ...process.env, LC_ALL: 'C' }, encoding: 'utf8' }).trim();
  return new Promise((resolve, reject) => {
    const sock = net.connect(w.hub.socket);
    let buffer = '';
    let step = 0;
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`the hub gave no answer to ${method} within ${timeoutMs} ms`)); }, timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', (error) => { clearTimeout(timer); reject(error); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = parse(buffer.slice(0, i)) ?? {};
        buffer = buffer.slice(i + 1);
        if (step === 0) { step = 1; sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token, peer: { pid: process.pid, start } })}\n`); }
        else if (step === 1) { step = 2; sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`); }
        else if (line.id === 1) { clearTimeout(timer); sock.destroy(); resolve(line); }
      }
    });
  });
}
async function tool(w: World, name: string, args: Line): Promise<Outcome> {
  const reply = await w.mcp.request('tools/call', { name, arguments: args });
  if (reply.error) return { isError: true, value: reply.error as Line, text: JSON.stringify(reply.error) };
  const result = (reply.result ?? {}) as Line;
  const text = Array.isArray(result.content) ? String(result.content.find((c: Line) => c?.type === 'text')?.text ?? '') : '';
  const value = (result.structuredContent ?? parse(text) ?? {}) as Line;
  return { isError: result.isError === true, value, text: text || JSON.stringify(value) };
}
const deepJob = (w: World, args: Line): Promise<Outcome> => tool(w, 'deep_job', args);

// ---- The take's fetch, as #3525 places it: a form of deep_job; every other deep_job field is left out.
const fetchArgs = (lib: Library, path: string): Line => ({ op: 'fetch', pack: ref(lib), asset: path });
export const fetchTake = (w: World, lib: Library, path: string): Promise<Outcome> => deepJob(w, fetchArgs(lib, path));
/** Your standing rule for the library's pack and license (`pack.rule` on the cli socket, #1820), then each take fetched. */
async function fetchLibrary(w: World, lib: Library): Promise<void> {
  const rule = await control(w, 'pack.rule', { pack: lib.id, licenses: [lib.license.id] });
  expect(rule.error, `pack.rule ${lib.id} ${lib.license.id}: ${show(rule)}`).toBeUndefined();
  for (const t of lib.takes) {
    let o = await fetchTake(w, lib, t.path);
    for (let i = 0; i < 240 && o.value.status !== 'fetched' && !o.isError && (o.value.status === 'held' || o.value.status === 'pending'); i++) { await sleep(500); o = await fetchTake(w, lib, t.path); }
    expect(o.value.status, `the hub fetches ${ref(lib)} ${t.path} under your standing rule: ${o.text.slice(0, 800)}`).toBe('fetched');
    expect(holds(w, sha256(t.bytes)), `${ref(lib)} ${t.path} is in the evidence store by its listed sha256`).toBe(true);
  }
}
/** A world with deepbuild/score installed and each library installed and, unless `fetch` is false, fetched under your standing rule. */
export async function scoreWorld(libs: Library[], fetch = true): Promise<{ w: World; dirs: { lib: Library; dir: string }[] }> {
  const w = await openWorld();
  await installScore(w);
  const dirs: { lib: Library; dir: string }[] = [];
  for (const lib of libs) dirs.push({ lib, dir: await installLibrary(w, lib) });
  if (fetch) for (const lib of libs) await fetchLibrary(w, lib);
  return { w, dirs };
}
