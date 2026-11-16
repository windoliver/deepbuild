// External agents/judge only. The hub, runner, archive reader, checkouts, comparison,
// outcome recording and removal are real. No supplied value is an eval outcome.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';

export async function events(root) {
  const token = readFileSync(join(root, 'control.token'), 'utf8').trim();
  const read = (after) => new Promise((resolve, reject) => {
    const socket = net.connect(join(root, 'hub.sock'));
    let pending = '', step = 0;
    const timer = setTimeout(() => { socket.destroy(); reject(Error('events.read timed out')); }, 10000);
    socket.on('error', (e) => { clearTimeout(timer); reject(e); });
    socket.setEncoding('utf8').on('data', (chunk) => {
      pending += chunk;
      while (pending.includes('\n')) {
        const end = pending.indexOf('\n');
        const line = JSON.parse(pending.slice(0, end));
        pending = pending.slice(end + 1);
        if (step++ === 0) socket.write(JSON.stringify({ v: 1, hello: 'cli', token }) + '\n');
        else if (line.role === 'cli') socket.write(JSON.stringify({ v: 1, id: 1, method: 'events.read', params: { after, limit: 1000 } }) + '\n');
        else if (line.id === 1) {
          clearTimeout(timer); socket.destroy();
          if (line.error) reject(Error(JSON.stringify(line.error)));
          else resolve(line.result.events);
        }
      }
    });
  });
  const all = [];
  for (;;) {
    const rows = await read(all.at(-1)?.log_pos ?? 0);
    if (!rows.length) return all;
    all.push(...rows);
  }
}

export function launcher() {
  const root = join(process.env.HOME, '.deepbuild');
  const settings = JSON.parse(readFileSync(join(root, 'boundary.json'), 'utf8'));
  const note = (v) => appendFileSync(settings.trace, JSON.stringify(v) + '\n');
  return {
    async planUsed() { return 0.05; },
    async work(request) {
      // Read the committed record at entry, BEFORE giving either side an answer.
      // This is an observation by the test boundary, not an event written by an agent.
      const recorded = await events(root);
      const bytes = readFileSync(join(request.cwd, settings.file), 'utf8');
      const side = bytes.includes(settings.rule) ? 'base' : 'change';
      const nonce = randomUUID();
      note({ kind: 'work', nonce, prompt: request.prompt, bytes, side, recorded });
      const deadline = Date.now() + 90000;
      while (!existsSync(settings.release)) {
        if (Date.now() > deadline) throw Error('external agent was not released by the acceptance test');
        await new Promise((done) => setTimeout(done, 25));
      }
      const quality = settings.case === 'regresses' ? (side === 'base' ? 0.8 : 0.2) : (side === 'base' ? 0.2 : 0.8);
      return { ok: true, result: `quality=${quality} nonce=${nonce}`, usage: { input: 100, output: 20 } };
    },
    async judge(request) {
      note({ kind: 'judge', request });
      // Missing grades are not zero and must never authorize removal, even though
      // the agent outputs in this case look just as good as the adopt control.
      if (settings.case === 'INCONCLUSIVE') return [];
      return request.outputs.map(({ label, text }) => {
        const score = /quality=([0-9.]+) nonce=/.exec(text);
        if (!score) throw Error('the real eval did not send the external agent output to its judge');
        return { label, score: Number(score[1]) };
      });
    },
  };
}
