import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createInterface } from 'node:readline';
import { RUNS } from './canvas-judge.mjs';

function core(binary, lines) {
  return new Promise((done, fail) => {
    const started = performance.now();
    const child = spawn(binary, ['canvas'], { stdio: ['pipe', 'pipe', 'inherit'] });
    const answers = [];
    child.on('error', fail);
    createInterface({ input: child.stdout }).on('line', (line) => {
      answers.push({ ms: performance.now() - started, value: JSON.parse(line) });
      if (answers.length === lines.length) child.stdin.end();
    });
    child.on('exit', (code) => (code === 0 && answers.length === lines.length ? done(answers) : fail(Error(`deep-show canvas exited ${code} after ${answers.length} of ${lines.length} answers`))));
    for (const line of lines) child.stdin.write(`${JSON.stringify(line)}\n`);
  });
}

export async function packChecks({ root, release }) {
  const fingerprint = release('deep-show', 'deep-show');
  const binary = join(root, 'target', 'release', 'deep-show');
  const folders = readdirSync(join(root, 'packs')).sort().map((f) => join(root, 'packs', f)).filter((f) => existsSync(join(f, 'pack.json')));
  const packs = folders.map((dir) => ({ id: `deepbuild/${JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8')).name}`, dir }));
  const dir = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const pack_checks = { dir: join(dir, 'checked'), key: randomBytes(32).toString('hex') };
    const world = { evidence: join(dir, 'evidence'), sessions: {}, panels: { main: { rect: [0, 0, 800, 600] } }, docs: {}, record: {}, packs, pack_checks };
    const once = async (filled) => {
      const loadStart = loadavg()[0];
      const [, first, held] = await core(binary, [{ world }, { call: { call: 'deep_kinds', op: 'list' } }, { call: { call: 'packs' } }]);
      const { packs: rows, counts } = held.value.reply ?? {};
      const refused = (rows ?? []).filter((r) => r.state !== 'installed').map((r) => `${r.pack}@${r.version}`);
      if (first.value.ok !== true || rows?.length !== packs.length || refused.length) throw Error(`the core didn't install the release's ${packs.length} packs: ${JSON.stringify({ refused, first: first.value, rows }).slice(0, 1500)}`);
      const ran = rows.filter((r) => r.checks !== 0).map((r) => `${r.pack}@${r.version}`);
      if (filled && (ran.length || Object.values(counts ?? { none: 1 }).some((n) => n !== 0))) throw Error(`a core on a filled store ran pack checks: ${JSON.stringify({ ran, counts })}`);
      return { first_reply_ms: first.ms, loadStart, loadEnd: loadavg()[0] };
    };
    await once(false);
    await once(true);
    const measured = [];
    for (let i = 0; i < RUNS; i++) measured.push(await once(true));
    console.log(JSON.stringify({ task: 'canvas-pack-checks', fingerprint, runs: measured }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
