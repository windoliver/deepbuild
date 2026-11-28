import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../packages/cli/dist/main.js', import.meta.url));
const FILES = 200;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

function skillFiles() {
  const files = { 'SKILL.md': '---\nname: shipnotes\ndescription: Writes the release notes for each change you ship.\n---\n\nWrite a short entry for each change.\n' };
  for (let i = 1; i < FILES; i++) {
    if (i % 4 === 0) files[`scripts/step-${i}.sh`] = `#!/bin/sh\nset -e\n${Array.from({ length: 40 }, (_, n) => `echo "step ${i} line ${n}" >> notes.log`).join('\n')}\n`;
    else files[`notes/part-${i}.md`] = `# Part ${i}\n\n${Array.from({ length: 40 }, (_, n) => `Line ${n} of part ${i}: say what changed and why.`).join('\n')}\n\n\`\`\`sh\ngit log --oneline -n ${i}\n\`\`\`\n`;
  }
  return files;
}

function asApp(home, socket) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    const waiting = new Map();
    let buffer = '';
    let n = 0;
    const app = {
      call: (method, params) => new Promise((done, fail) => {
        const id = `b${++n}`;
        waiting.set(id, (line) => (line.error ? fail(Error(`${method}: ${JSON.stringify(line.error)}`)) : done(line.result)));
        sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
      }),
      close: () => sock.destroy(),
    };
    sock.setEncoding('utf8');
    sock.on('error', reject);
    sock.on('data', (chunk) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = JSON.parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (line.hello) sock.write(`${JSON.stringify({ v: 1, hello: 'app', token: readFileSync(join(home, '.deepbuild', 'control.token'), 'utf8').trim() })}\n`);
        else if (line.role) resolve(app);
        else if (waiting.has(line.id)) { waiting.get(line.id)(line); waiting.delete(line.id); }
      }
    });
  });
}

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-skill-audit-bench-')));
const home = join(dir, 'home');
const repo = join(dir, 'source');
const loginPath = '/usr/bin:/bin';
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DEEP_') && !k.startsWith('CLAUDE') && !k.startsWith('GIT_'))), HOME: home, LC_ALL: 'C' };
mkdirSync(join(home, '.deepbuild'), { recursive: true, mode: 0o700 });
writeFileSync(join(home, '.deepbuild', 'config.json'), JSON.stringify({ runner: { login_path: loginPath } }));
for (const [rel, text] of Object.entries(skillFiles())) {
  const file = join(repo, 'skills/shipnotes', rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text, { mode: rel.endsWith('.sh') ? 0o755 : 0o644 });
}
const git = (...args) => execFileSync('git', args, { cwd: repo, env: { ...env, GIT_AUTHOR_NAME: 'bench', GIT_AUTHOR_EMAIL: 'bench@example.invalid', GIT_COMMITTER_NAME: 'bench', GIT_COMMITTER_EMAIL: 'bench@example.invalid' }, encoding: 'utf8' }).trim();
git('init', '-q');
git('add', '-A');
git('commit', '-q', '-m', 'skill');
const commit = git('rev-parse', 'HEAD');

const hub = spawn(process.execPath, [CLI, 'hub', 'run'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
try {
  await new Promise((resolve, reject) => { hub.stdout.once('data', resolve); hub.once('exit', () => reject(Error('the hub did not start'))); });
  const app = await asApp(home, join(home, '.deepbuild', 'hub.sock'));
  const runs = [];
  for (let i = 0; i <= 5; i++) {
    const t0 = performance.now();
    const plan = await app.call('agents.propose', { via: 'app', agents: ['claude-code'], skill: { repo, commit, path: 'skills/shipnotes' } });
    const ms = performance.now() - t0;
    if (plan.files?.length !== FILES) throw Error(`the plan names ${plan.files?.length} files, not the skill's ${FILES}`);
    if (i > 0) runs.push(ms);
  }
  app.close();
  console.log(JSON.stringify({ proposeMs: median(runs), files: FILES }));
} finally {
  hub.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => (hub.exitCode !== null ? resolve() : hub.once('exit', resolve))), sleep(10_000)]);
  rmSync(dir, { recursive: true, force: true });
}
