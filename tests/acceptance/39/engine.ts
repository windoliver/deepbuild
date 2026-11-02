// Codex's own hook engine: a real `codex exec` turn in a scratch CODEX_HOME on a local stand-in for the model API, with its hooks approved once as Codex's /hooks records it.
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import { childEnv, own, trustAll, type Home, type Line } from './helpers.ts';

/** A real `codex exec` in a scratch home with a hook per event printing `replies[event]` once. Returns what the model was then sent: a Stop reply Codex applied continues the turn with its reason in a second request; one it failed doesn't (checked in the suite with a malformed reply). */
export async function engineRun(h: Home, replies: Record<string, string>): Promise<{ requests: number; bodies: string[]; err: string }> {
  const work = join(h.tmp, 'engine');
  const codexHome = h.codexHome;
  mkdirSync(work, { recursive: true });
  const hooks: Record<string, unknown> = {};
  for (const [event, reply] of Object.entries(replies)) {
    const file = join(work, `reply-${event}.json`);
    writeFileSync(file, reply);
    const script = join(work, `hook-${event}.sh`);
    writeFileSync(script, `#!/bin/sh\ncat >/dev/null\nif [ -f '${file}' ]; then cat '${file}'; rm -f '${file}'; fi\nexit 0\n`);
    chmodSync(script, 0o755);
    hooks[event] = [{ hooks: [{ type: 'command', command: script }] }];
  }
  writeFileSync(h.hooksFile, JSON.stringify({ hooks }));
  writeFileSync(h.configToml, '');
  await trustAll(h);
  const bodies: string[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c: string) => (body += c));
    req.on('end', () => {
      if (!req.url?.includes('responses')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[],"models":[]}'); return; }
      bodies.push(body);
      const requests = bodies.length;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const ev = (o: Line) => res.write(`event: ${String(o.type)}\ndata: ${JSON.stringify(o)}\n\n`);
      ev({ type: 'response.created', response: { id: `r${requests}` } });
      ev({ type: 'response.output_item.done', item: { type: 'message', role: 'assistant', id: `m${requests}`, content: [{ type: 'output_text', text: 'done' }] } });
      ev({ type: 'response.completed', response: { id: `r${requests}`, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } });
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const provider = `\nmodel = "mock"\nmodel_provider = "mock"\n[model_providers.mock]\nname = "mock"\nbase_url = "http://127.0.0.1:${port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`;
  writeFileSync(h.configToml, `${provider}\n${readFileSync(h.configToml, 'utf8')}`);
  const err = await new Promise<string>((resolve) => {
    const c = spawn(join(h.bin, 'codex'), ['exec', '--json', '--skip-git-repo-check', '-s', 'read-only', '-'], { cwd: work, env: childEnv(h, { CODEX_HOME: codexHome }), stdio: ['pipe', 'pipe', 'pipe'] });
    own(c.pid);
    let e = '';
    c.stderr.setEncoding('utf8').on('data', (d: string) => (e += d));
    const timer = setTimeout(() => c.kill('SIGKILL'), 60_000);
    c.on('close', () => { clearTimeout(timer); resolve(e); });
    c.stdin.end('hello');
  });
  server.close();
  return { requests: bodies.length, bodies, err };
}
