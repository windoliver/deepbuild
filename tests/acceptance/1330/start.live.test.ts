// The issue's Proof: a real Claude Code and a real Codex session started under one approval on this repo, by hand and
// on a plan, never in hosted CI. Skipped unless DEEP_1330_LIVE=1. It runs on your own home and installed hub (your
// sign-ins, your plan), asks you to confirm the approval (Touch ID or your password), and leaves both sessions and
// their worktrees for you to look at and remove (README, The live run).
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { AC, CLI, Client, jsonOut, mentions, NODE, REPO, waitFor, type Line } from './helpers.ts';

const LIVE = process.env.DEEP_1330_LIVE === '1';
const deep = (args: string[]): { code: number | null; out: Line | undefined; text: string } => {
  const r = spawnSync(NODE, [CLI, ...args], { cwd: REPO, encoding: 'utf8', timeout: 600_000 });
  return { code: r.status, out: jsonOut(r.stdout ?? ''), text: `exit ${r.status}, stdout ${(r.stdout ?? '').slice(-1000)}, stderr ${(r.stderr ?? '').slice(-1000)}` };
};

test.skipIf(!LIVE)(`live (${AC[1]}, ${AC[6]}, ${AC[9]}): a real Claude Code and a real Codex session start under one approval on this repo`, async () => {
  const root = join(homedir(), '.deepbuild');
  const client = await Client.open(join(root, 'hub.sock'), root);
  try {
    const until = new Date(Date.now() + 2 * 3600_000).toISOString();
    const asked = deep(['start', 'approve', '--repo', REPO, '--issues', '1330', '--agents', 'claude-code,codex', '--at-once', '2', '--plan-share', '10', '--until', until, '--json']);
    expect(asked.code, `deep start approve (${asked.text})`).toBe(0);
    const handle = String(asked.out?.ask);
    const created = await waitFor(async () => (await client.events('ask.created')).find((e) => mentions(e, handle.slice(4))), 30_000, `the ask ${handle}`);
    const yes = (created.data?.options as { id: string; decision?: string }[]).find((o) => o.decision === 'allow')!;
    const answered = deep(['inbox', 'answer', handle, yes.id]);
    expect(answered.code, `deep inbox answer, once you confirm (${answered.text})`).toBe(0);
    for (const agent of ['claude-code', 'codex']) {
      const r = deep(['start', '--repo', REPO, '--issue', '1330', '--agent', agent, '--prompt', 'Reply with the single word ready. Change nothing.', '--json']);
      expect(r.out?.status, `${agent}: deep start (${r.text})`).toBe('started');
      const run = String(r.out!.run);
      const first = await waitFor(async () => (await client.events()).find((e) => mentions(e, run)), 120_000, `${agent}'s first event naming run ${run}`);
      const row = await waitFor(async () => ((await client.call('sessions.read')).sessions as Line[]).find((x) => mentions(x, run)), 60_000, `${agent}'s row`);
      console.log(`${agent}: run ${run}, first event ${first.kind}, sandbox ${JSON.stringify(row.sandbox)}`);
      expect(row.sandbox, `${agent}: its row says what its sandbox holds`).toBeTruthy();
    }
  } finally {
    client.close();
  }
});
