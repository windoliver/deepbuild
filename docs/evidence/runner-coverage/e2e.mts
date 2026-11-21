// Hand e2e: a real dev hub (`deep hub run --root`) with Claude Code's shipped facts and a stand-in `claude` on the
// login PATH: at a listed version, at one between two listed ones, and at a listed version's pre-release build. For each: a read job submitted on the
// hub's socket (the runner), and a session's SessionStart hook whose transcript names that version (the hub).
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACCOUNT, Client, NESTING, cleanup, install, sendHook, startHub, stopHub, sub, tempDir, uuid, waitFor, writeHubConfig,
} from '../../../tests/acceptance/159/helpers.ts';
// As tests/acceptance/159/world.ts has them (that file imports sources by .js names, which plain node can't load).
const job = (kind: string, prompt: string) => ({ kind, agent: 'claude-code', prompt, deadline_ms: 120_000 });
const claudeLimits = (used: number, at: number) => ({ five_hour: { used_percentage: used, resets_at: Math.floor(at / 1000) }, seven_day: { used_percentage: 20, resets_at: Math.floor((at + 5 * 86_400_000) / 1000) } });

const WT = fileURLToPath(new URL('../../../', import.meta.url));
const facts = JSON.parse(readFileSync(join(WT, 'adapters/claude-code.facts.json'), 'utf8')) as { versions: string[] };
const tmp = (s: string) => s.replace(/\/(private\/)?var\/folders\/[^ ]*?\/T\/[^/ ]+/g, '<tmp>');
console.log(`== Claude Code facts list: ${facts.versions.join(', ')}`);

for (const version of ['2.1.304', '2.1.300', '2.1.304-beta']) {
  console.log(`\n################ stand-in claude ${version} on the login PATH ################`);
  const bin = install(sub(tempDir(), 'bin'), { version });
  const root = sub(tempDir(), 'root');
  writeHubConfig(root, { loginPath: `${dirname(bin)}:/usr/bin:/bin` });
  const hub = await startHub(root, { ...NESTING });
  const client = await Client.open(hub);
  console.log(`  dev hub pid ${hub.pid} (started by this script)`);
  try {
    await client.call('windows.report', { agent: 'claude-code', account: ACCOUNT, rate_limits: claudeLimits(5, Date.now() + 3 * 3_600_000) });
    // The runner: one read job through the hub's socket.
    const rec = (await client.call('job.submit', { spec: job('read', 'Which version are you?') })) as { job: string; state: string };
    const end = await waitFor(async () => {
      const r = (await client.call('job.status', { job: rec.job })) as { state: string; refused?: string; binary?: { version: string } };
      return ['finished', 'stopped', 'refused', 'lost'].includes(r.state) ? r : undefined;
    }, 60_000, 'the job to end');
    console.log(`  runner: read job -> ${end.state}${end.refused ? `\n    refused: ${tmp(end.refused)}` : `  (ran claude ${end.binary?.version})`}`);
    // The hub: a session whose transcript names that version.
    const session = uuid();
    const cwd = sub(tempDir(), 'w');
    const transcript = join(cwd, `${session}.jsonl`);
    mkdirSync(cwd, { recursive: true });
    writeFileSync(transcript, `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hi.' }, uuid: uuid(), timestamp: new Date().toISOString(), cwd, sessionId: session, version })}\n`);
    await sendHook(hub.socket, 'SessionStart', { session_id: session, cwd, transcript_path: transcript, permission_mode: 'default', source: 'startup', model: 'claude-haiku-5-5' });
    const mine = async () => (await client.events()).filter((e) => JSON.stringify(e.data ?? {}).includes(session));
    await waitFor(async () => ((await mine()).some((e) => e.kind === 'row.set') ? true : undefined), 20_000, 'the session\'s row');
    await new Promise((r) => setTimeout(r, 1500));
    const all = await mine();
    const flag = all.map((e) => (e.data as { flag?: { code: string; text: string } } | undefined)?.flag).find((f) => f?.code === 'watch-only');
    console.log(`  hub:    session ${session.slice(0, 8)} -> ${flag ? `watch-only: ${flag.text}` : 'verified, no watch-only flag'}`);
  } finally {
    client.close();
    await stopHub(hub);
    console.log(`  stopped the hub this script started (pid ${hub.pid})`);
  }
}
await cleanup();
console.log('\n== done; temp folders removed');
