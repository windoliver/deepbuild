import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const brief = (value) => JSON.stringify(value).slice(0, 1500);

const built = spawnSync('cargo', ['build', '--locked', '--release', '-p', 'deep-show', '--bin', 'deep-show'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
if (built.status !== 0) throw Error(`cargo build --release -p deep-show --bin deep-show exited ${built.status}`);

const packs = readdirSync(join(root, 'packs')).sort().filter((folder) => existsSync(join(root, 'packs', folder, 'pack.json'))).map((folder) => {
  const dir = join(root, 'packs', folder);
  const { name, version } = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8'));
  return { id: `deepbuild/${name}`, version, dir };
});
const evidence = mkdtempSync(join(tmpdir(), 'deep-core-first-reply-'));
const load = [loadavg()[0]];
const started = performance.now();
const core = spawn(join(root, 'target', 'release', 'deep-show'), ['canvas'], { cwd: root, stdio: ['pipe', 'pipe', 'inherit'] });
core.stdin.on('error', () => undefined);
try {
  const lines = createInterface({ input: core.stdout })[Symbol.asyncIterator]();
  const answer = async (line) => {
    core.stdin.write(`${JSON.stringify(line)}\n`);
    const { value, done } = await lines.next();
    if (done) throw Error(`deep-show canvas ended before it answered ${brief(line)}`);
    return JSON.parse(value);
  };
  const world = await answer({ world: { evidence, sessions: {}, record: {}, docs: {}, packs: packs.map(({ id, dir }) => ({ id, dir })) } });
  if (world.ok !== true) throw Error(`deep-show canvas answered its world ${brief(world)}`);
  const first = await answer({ call: { call: 'packs' } });
  const first_reply_ms = performance.now() - started;
  const rows = first.ok === true && Array.isArray(first.reply?.packs) ? first.reply.packs : [];
  const left = packs.filter(({ id, version }) => !rows.some((row) => row.pack === id && row.version === version && row.state === 'installed'));
  if (left.length) throw Error(`deep-show canvas didn't install ${left.map(({ id }) => id).join(', ')} of the ${packs.length} shipped packs: ${brief(first)}`);
  const rss = spawnSync('ps', ['-o', 'rss=', '-p', String(core.pid)], { encoding: 'utf8' });
  const rss_bytes = rss.status === 0 && Number(rss.stdout) > 0 ? Number(rss.stdout) * 1024 : null;
  load.push(loadavg()[0]);
  console.log(JSON.stringify({ task: 'canvas-core-first-reply', packs: packs.length, first_reply_ms, rss_bytes, load }));
} finally {
  core.kill('SIGKILL');
  rmSync(evidence, { recursive: true, force: true });
}
