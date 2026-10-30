// The Proof of #69, end to end on a real hub: three plans (a send, a deletion and a root plan on a host) shown in
// `deep inbox` and answered with `deep inbox answer`, then one approved run stopped for stepping outside its plan.
// node scripts/plans-proof.mjs <out dir>: writes transcript.txt there and exits non-zero on any miss.
//
// It runs the built CLI and hub (npm run build --workspaces) in a temporary HOME, stubs only the OS confirmation
// (DEEP_HUB_TEST_CONFIRM, as #24's suite does) and stops only the hub it started, by PID.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openAsks } from '../packages/asks/dist/index.js';
import { openRecord } from '../packages/record/dist/index.js';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const CLI = join(REPO, 'packages/cli/dist/main.js');
const out = process.argv[2];
if (!out) throw Error('Usage: node scripts/plans-proof.mjs <out dir>');
mkdirSync(out, { recursive: true });
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const lines = [];
const say = (text) => { lines.push(text); process.stdout.write(`${text}\n`); };
const fail = (why) => { say(`FAIL ${why}`); writeFileSync(join(out, 'transcript.txt'), `${lines.join('\n')}\n`); process.exit(1); };

const dir = mkdtempSync(join(tmpdir(), 'dp69-'));
const home = join(dir, 'h');
const root = join(home, '.deepbuild');
mkdirSync(root, { recursive: true, mode: 0o700 });
const confirm = join(dir, 'confirm');
writeFileSync(confirm, 'confirmed\n');
const env = { PATH: process.env.PATH, HOME: home, LC_ALL: 'C', DEEP_HUB_TEST_CONFIRM: confirm };
const who = { actor: 'you', scope: 'you' };
const core = { writer: 'core', ...who, session: 'S1', project: 'shop' };
const step = (does, changes, undo, cost = 0) => ({ does, changes, undo, public: true, cost });

// ---- Three authority asks with their plans, raised as the core raises them, with the hub stopped.
let now = Date.now();
const record = await openRecord({ path: join(root, 'ledger.db'), now: () => now });
const asks = await openAsks({ record, now: () => now, deliver: () => undefined });
await record.append({ writer: 'hook', ...who, session: 'S1', project: 'shop', agent: 'claude-code' }, { v: 1, id: ulidAt(now), kind: 'session.start', ts: now, data: { agent: 'claude-code', worktree: '/work/shop', branch: 'main', thread: 'S1' } });
const raise = (source, question, steps) => asks.raise(core, source, {
  kind: 'authority', question, options: [{ id: 'approve', label: 'Go ahead', decision: 'allow' }, { id: 'decline', label: 'No', decision: 'deny' }],
  recommended: null, deadline: now + 86_400_000, fallback: 'you', default: 'decline', provisional: false, owner: 'you', key: sha256(question), pinned_to: { kind: 'evidence', ref: sha256(question) },
}, { steps, diff: sha256(`diff of ${question}`) });
const send = await raise('effect.send', 'Email the beta list that v1.4.0 is out?', [step('Send the v1.4.0 announcement to beta@lists.example (312 people)', ['beta@lists.example'], null)]);
const del = await raise('effect.delete', 'Delete the branches old-ui and old-api on origin?', [
  step('Delete branch old-ui on origin', ['origin/old-ui'], 'git push origin 3f9c2ab:refs/heads/old-ui'),
  step('Delete branch old-api on origin', ['origin/old-api'], 'git push origin 9a41d07:refs/heads/old-api'),
]);
const rootPlan = await raise('host.root_plan', 'Run this root plan on build-01 as root, under sudo?', [
  step('sudo apt-get install -y nvidia-driver-550 on build-01', ['build-01: package nvidia-driver-550'], 'sudo apt-get purge -y nvidia-driver-550'),
  step('sudo loginctl enable-linger you on build-01', ['build-01: lingering for you'], 'sudo loginctl disable-linger you'),
  step('Reboot build-01 to load the driver', ['build-01: running services'], null),
]);
await record.close();

// ---- The hub, and the CLI as you run it.
const hub = spawn(process.execPath, [CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
try {
  await new Promise((ready, refused) => {
    let text = '';
    const timer = setTimeout(() => refused(Error('the hub gave no ready line in 30 s')), 30_000);
    hub.stdout.setEncoding('utf8').on('data', (d) => { text += d; if (text.includes('\n')) { clearTimeout(timer); ready(); } });
    hub.on('exit', (code) => refused(Error(`the hub exited ${code}`)));
  });
  const deep = (...args) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, [CLI, ...args], { cwd: dir, env, encoding: 'utf8' }) };
    } catch (e) {
      return { code: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  };
  say('$ deep inbox');
  const listed = deep('inbox');
  say(listed.out.trimEnd());
  for (const [ask, what] of [[send, 'the send'], [del, 'the deletion'], [rootPlan, 'the root plan']]) {
    const block = listed.out.split('\n').slice(listed.out.split('\n').findIndex((l) => l.startsWith(ask)));
    if (!block[0]?.startsWith(ask) || !/^\s+plan [0-9a-f]{12}: /.test(block[1] ?? '')) fail(`deep inbox doesn't show ${what}'s plan under ${ask}`);
  }
  if (!/Send the v1\.4\.0 announcement.*undo: can't undo/.test(listed.out)) fail("the send's step isn't marked can't undo");
  if (!/Reboot build-01 to load the driver.*undo: can't undo/.test(listed.out)) fail("the root plan's reboot isn't marked can't undo");

  say('');
  for (const [ask, option] of [[send, 'decline'], [del, 'approve'], [rootPlan, 'approve']]) {
    say(`$ deep inbox answer ${ask} ${option}`);
    const answered = deep('inbox', 'answer', ask, option);
    say(answered.out.trimEnd());
    if (answered.code !== 0) fail(`deep inbox answer ${ask} ${option} exited ${answered.code}`);
  }

  // ---- The deletion's run, against the approved plan: its two steps run; a third, added after your yes, stops it.
  say('');
  say('A run of the approved deletion, each step checked before it is taken:');
  const reopened = await openRecord({ path: join(root, 'ledger.db'), now: () => Date.now() });
  const reader = await openAsks({ record: reopened, now: () => Date.now(), deliver: () => undefined });
  const shown = await reader.card(del);
  const answered = (await reopened.read({ after: 0, limit: 10_000 })).find((e) => e.kind === 'ask.answered' && e.subject === del);
  if (answered?.data.plan_hash !== shown.plan.hash) fail(`your yes to ${del} binds ${answered?.data.plan_hash}, not the plan shown, ${shown.plan.hash}`);
  say(`  ${del}: your yes binds plan ${shown.plan.hash.slice(0, 12)}, the one deep inbox showed`);
  const added = step('Delete branch release-1.3 on origin', ['origin/release-1.3'], 'git push origin 77c0e1f:refs/heads/release-1.3');
  let stopped;
  for (const s of [...shown.plan.steps, added]) {
    const check = await reader.beforeStep(del, s);
    say(`  ${check.run ? 'runs   ' : 'STOPPED'} ${s.does}${check.run ? '' : `: not in the plan you approved; asked again as ${check.ask}`}`);
    if (!check.run) { stopped = { step: s, ask: check.ask }; break; }
  }
  if (!stopped || stopped.step !== added) fail('the run was not stopped before the step added after your yes');
  const again = await reader.card(stopped.ask);
  if (again.kind !== 'authority' || !again.plan?.steps.some((s) => s.does === added.does)) fail(`${stopped.ask} isn't an authority ask showing the added step`);
  if ((await reader.beforeStep(del, added)).ask !== stopped.ask) fail('the same added step was asked about twice');
  await reopened.close();
  say('');
  say('$ deep inbox');
  say(deep('inbox').out.trimEnd());
  say('');
  say('PASS three plans shown and answered (a send, a deletion and a root plan); one run stopped for stepping outside its plan');
} finally {
  writeFileSync(join(out, 'transcript.txt'), `${lines.join('\n')}\n`);
  // Stop the hub this started, by its process group, and wait for it before removing its home.
  const exited = new Promise((done) => (hub.exitCode !== null ? done() : hub.once('exit', done)));
  try { process.kill(-hub.pid, 'SIGTERM'); } catch { /* gone */ }
  await Promise.race([exited, new Promise((done) => setTimeout(done, 10_000))]);
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

/** A ULID at `ms` with a random tail. */
function ulidAt(ms) {
  const A = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let s = '';
  for (let t = ms, i = 0; i < 10; i++, t = Math.floor(t / 32)) s = A[t % 32] + s;
  for (let i = 0; i < 16; i++) s += A[Math.floor(Math.random() * 32)];
  return s;
}
