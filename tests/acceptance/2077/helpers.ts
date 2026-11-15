import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import {
  CLI, NODE, REPO, allEvents, childEnv, cleanup, control, makeWorld, own, run, sleep, stopHub,
  type Ev, type Hub, type Line, type World,
} from '../303/helpers.ts';

export { allEvents, cleanup, control, stopHub };
export const RULE = 'Never edit the generated stubs by hand';
export const FILE = 'legacy/AGENTS.md';
export const BEFORE = `# Legacy rules\r\n\r\n- ${RULE}\r\n\r\nKeep this paragraph, including its trailing spaces.  \r\n`;
export const AFTER = BEFORE.replace(`- ${RULE}\r\n`, '');
const ACCOUNT = 'acceptance-2077';
const DAY = 86_400_000;
export interface Fixture extends World { trace: string; release: string; taskIds: string[] }

export async function fixture(which: string): Promise<Fixture> {
  // Check before importing product modules: an absent build is a prerequisite,
  // not proof of #2077. Never follow another checkout's workspace links here.
  if (!existsSync(CLI)) throw Error('BLOCKED: packages/cli/dist/main.js is absent; the installed hub/CLI must be built before this acceptance test can run');
  const w = makeWorld({ drafts: [] });
  const trace = join(w.tmp, 'external.jsonl'), release = join(w.tmp, 'release');
  mkdirSync(join(w.repo, 'legacy'));
  writeFileSync(join(w.repo, FILE), BEFORE);
  const env = childEnv(w.home, {
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  });
  const t0 = Date.now() - 100 * DAY;
  for (const args of [['add', '-A'], ['commit', '-q', '-m', 'legacy instructions']]) {
    const r = await run('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
      cwd: w.repo, env: { ...env, GIT_AUTHOR_DATE: new Date(t0).toISOString(), GIT_COMMITTER_DATE: new Date(t0).toISOString() },
    });
    if (r.code !== 0) throw Error(`BLOCKED: fixture git: ${r.stderr}`);
  }
  // Only synthetic sign-in metadata, no credential or token. Prevent keychain access.
  writeFileSync(join(w.home, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: ACCOUNT } }));
  writeFileSync(join(w.home, '.claude', '.credentials.json'), '{}');
  const bin = join(w.tmp, 'bin');
  mkdirSync(bin);
  for (const [name, facts] of [['claude', 'claude-code'], ['codex', 'codex']] as const) {
    const versions = JSON.parse(readFileSync(join(REPO, 'adapters', `${facts}.facts.json`), 'utf8')).versions;
    writeFileSync(join(bin, name), `#!${NODE}\nif (process.argv.includes('--version')) console.log(${JSON.stringify(versions.at(-1))}); else { console.error('Unexpected external control-plane agent: only eval work/judge are scripted'); process.exitCode = 1; }\n`, { mode: 0o755 });
  }
  const configFile = join(w.root, 'config.json');
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  writeFileSync(configFile, JSON.stringify({ ...config, runner: { login_path: `${bin}:${dirname(NODE)}:/usr/bin:/bin` }, plan: { reserve_pct: 10 } }));
  writeFileSync(join(w.root, 'boundary.json'), JSON.stringify({ case: which, file: FILE, rule: RULE, trace, release }));

  const { openRecord, ulid } = await import('../../../packages/record/src/index.ts');
  const { openEvidenceStore } = await import('../../../packages/evidence/src/index.ts');
  const evidence = await openEvidenceStore({ root: join(w.root, 'evidence'), now: Date.now });
  const record = await openRecord({ path: join(w.root, 'ledger.db'), now: Date.now, evidence });
  const taskIds: string[] = [];
  try {
    // 24 distinct real archive-shaped past tasks in this repo; no tool touches legacy/**.
    for (let i = 0; i < 24; i++) {
      const at = t0 + (70 + i) * DAY, session = ulid(at), message = `prompt-${i}`;
      taskIds.push(`session:${session}#${message}`);
      await record.append({ writer: 'hook', actor: 'you', scope: 'you', session, project: 'fixture-2077', agent: 'claude-code' }, {
        v: 1, id: ulid(at), kind: 'session.start', ts: at,
        data: { agent: 'claude-code', worktree: w.repo, branch: 'main', thread: session },
      });
      const transcript = JSON.stringify({ type: 'user', uuid: message, sessionId: session, timestamp: new Date(at).toISOString(), cwd: w.repo, gitBranch: 'main', message: { role: 'user', content: `Fix cart item ${i}: count its quantity in the total.` } });
      const atHandle = await record.keep({ writer: 'app', actor: 'you', scope: 'you' }, { bytes: Buffer.from(transcript + '\n'), kind: 'transcript', source: 'claude-code' });
      await record.append({ writer: 'app', actor: 'you', scope: 'you' }, { v: 1, id: ulid(at + 1), kind: 'transcript.archived', ts: at + 1, data: { session: `session:${session}`, evidence: atHandle.replace(/^ev:/, '') } });
    }
  } finally { await record.close(); }
  return { ...w, trace, release, taskIds };
}

export async function start(w: Fixture): Promise<Hub> {
  const env = childEnv(w.home, {
    DEEP_HUB_TEST_CONFIRM: w.confirm,
    NODE_OPTIONS: `--import=${fileURLToPath(new URL('./boundary.mjs', import.meta.url))}`,
    PATH: `${join(w.tmp, 'bin')}:${dirname(NODE)}:/usr/bin:/bin`,
  });
  expect(env.DEEP_HUB_TEST_EVAL, 'the installed-hub removal path: no supplied eval result').toBeUndefined();
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let stderr = '', stdout = '';
  child.stderr!.setEncoding('utf8').on('data', (s: string) => { stderr += s; });
  const exit = new Promise<void>((done) => child.once('exit', () => done()));
  const ready = await Promise.race([
    new Promise<Line>((done) => child.stdout!.setEncoding('utf8').on('data', (s: string) => {
      stdout += s;
      if (stdout.includes('\n')) { try { done(JSON.parse(stdout.split('\n')[0]!)); } catch { done({}); } }
    })), exit.then(() => ({} as Line)), sleep(30000).then(() => ({} as Line)),
  ]);
  if (!ready.ready) throw Error(`BLOCKED: installed hub could not start: ${stderr.slice(-2000)}`);
  return { pid: child.pid!, child, exit, socket: String(ready.socket), root: w.root, home: w.home, readyAt: Date.now(), clock: undefined, plant: undefined, stderr: () => stderr };
}
export const deep = (w: World, args: string[]) => run(NODE, [CLI, ...args], { cwd: w.repo, env: childEnv(w.home), timeoutMs: 15000 });
export async function lessons(w: World): Promise<Line[]> {
  const r = await deep(w, ['memory', '--json']);
  expect(r.code, `deep memory --json: ${r.stderr}`).toBe(0);
  return JSON.parse(r.stdout).lessons;
}
export async function window(hub: Hub, used: number, resets: number) {
  await control(hub, 'windows.report', { agent: 'claude-code', account: ACCOUNT, rate_limits: { five_hour: { used_percentage: used, resets_at: resets / 1000 } } });
}
export const jobs = async (hub: Hub): Promise<Line[]> => (await control(hub, 'job.list', {})).jobs;
export const observations = (w: Fixture): Line[] => existsSync(w.trace) ? readFileSync(w.trace, 'utf8').trim().split('\n').filter(Boolean).map((s) => JSON.parse(s)) : [];
export async function until<T>(read: () => T | Promise<T>, done: (v: T) => boolean, ms = 60000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) { const v = await read(); if (done(v) || Date.now() >= end) return v; await sleep(100); }
}

// The issue specifies the record's content, not a new event kind or nesting key.
// Accept inline plans/reports or content-hashed evidence linked by an event.
export function objects(value: unknown): Line[] {
  if (typeof value === 'string' && /^[\[{]/.test(value)) { try { return objects(JSON.parse(value)); } catch { return []; } }
  if (!value || typeof value !== 'object') return [];
  return [value as Line, ...Object.values(value).flatMap(objects)];
}
export async function recorded(events: Ev[], w: World): Promise<{ event: Ev; value: Line }[]> {
  const { openEvidenceStore } = await import('../../../packages/evidence/src/index.ts');
  const store = await openEvidenceStore({ root: join(w.root, 'evidence'), readOnly: true });
  const out: { event: Ev; value: Line }[] = [];
  for (const event of events) {
    out.push(...objects(event.data).map((value) => ({ event, value })));
    const hashes = new Set([
      ...(Array.isArray(event.evidence) ? event.evidence as string[] : []),
      ...(event.kind === 'evidence.stored' && typeof event.data.sha256 === 'string' ? [event.data.sha256] : []),
      ...[...JSON.stringify(event.data).matchAll(/ev:([a-f0-9]{64})/g)].map((m) => m[1]!),
    ]);
    for (const hash of hashes) {
      const text = Buffer.from(await store.read(hash.replace(/^ev:/, ''))).toString('utf8');
      out.push(...objects(text).map((value) => ({ event, value })));
    }
  }
  return out;
}
export const isPlan = (v: Line): boolean => Array.isArray(v.tasks) && !!v.variants?.base?.files && !!v.variants?.change?.files && Number.isInteger(v.repeats);
export async function frozenAt(events: Ev[], w: Fixture) {
  const found = (await recorded(events, w)).filter(({ value }) => isPlan(value));
  expect(found.length, 'the record already holds tasks, both variants and repeats before either external side starts').toBeGreaterThan(0);
  const plan = found[0]!.value;
  expect(plan.tasks.length, 'a deciding cohort of archived tasks').toBeGreaterThan(1);
  for (const id of [...plan.tasks, ...(plan.fitted ?? [])]) expect(w.taskIds).toContain(id);
  expect(plan.variants.base.files[FILE], 'the original bytes are the base variant').toBe(BEFORE);
  expect(plan.variants.change.files[FILE], 'the candidate removes only the lesson line').toBe(AFTER);
  expect(plan.repeats).toBeGreaterThan(0);
  expect(plan.models?.agent).toBeTruthy();
  expect(plan.models?.judge).toBeTruthy();
  expect(plan.measures?.length).toBeGreaterThan(0);
  expect(plan.rule).toBe('paired-mean-one-sided-95');
  return structuredClone(plan);
}
