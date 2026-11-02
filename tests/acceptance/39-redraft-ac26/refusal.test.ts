// #39 AC26, as amended by the user's decision: a Codex job asked to write a file is refused by the sandbox confining
// it, and the refusal is its recorded stop cause. macOS forbids nested Seatbelt, so what confines the job is the
// supervisor's sandbox. The stand-in really runs the write (README); only the operating system can make it fail.
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, home, sub, tempDir, type Line } from '../159/helpers.ts';
import { openWorld, type World } from '../159/world.ts';

afterEach(cleanup, 30_000);

const STAND_IN = fileURLToPath(new URL('./fixtures/stand-in-codex.pl', import.meta.url));
const ACCOUNT = 'codex-account-ac26';
const WRITE = 'Write the notes down.\n@sh printf hello > notes.md';
const OS_REFUSED = /Operation not permitted/;

function installStandIn(): string {
  const bin = join(sub(tempDir(), 'bin'), 'codex');
  copyFileSync(STAND_IN, bin);
  chmodSync(bin, 0o755);
  return bin;
}
/** A fake sign-in holding made-up values, where Codex keeps one; no test touches the real ~/.codex. */
function signInCodex(): void {
  const dir = join(home(), '.codex');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'auth.json'), `${JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'dh39-fake-access', refresh_token: 'dh39-fake-refresh', account_id: ACCOUNT } })}\n`, { mode: 0o600 });
}
const eventsOf = (stdout: string): Line[] => stdout.split('\n').filter((l) => l.trim()).flatMap((l) => {
  try { return [JSON.parse(l) as Line]; } catch { return []; }
});
const commands = (stdout: string): Line[] => eventsOf(stdout).filter((e) => e.type === 'item.completed' && e.item?.type === 'command_execution').map((e) => e.item as Line);
function launchOf(stdout: string): { argv: string[]; stdin: string } {
  for (const e of eventsOf(stdout)) {
    const text = e.item?.text;
    if (e.type === 'item.completed' && typeof text === 'string' && text.startsWith('standin:')) {
      const r = JSON.parse(text.slice(8)) as { argv: string[]; stdin: string };
      return { argv: r.argv, stdin: Buffer.from(r.stdin, 'base64').toString('utf8') };
    }
  }
  throw Error(`the stand-in never reported its launch; the job's output was: ${stdout.slice(0, 2000) || '(empty)'}`);
}
/** Runs the stand-in by hand in a fresh folder, under `seatbelt` if given, and what it printed for the write. */
function byHand(bin: string, seatbelt: boolean): { item: Line; written: boolean } {
  const dir = tempDir();
  const argv = [bin, 'exec', '--json', '-'];
  const out = seatbelt
    ? execFileSync('/usr/bin/sandbox-exec', ['-p', `(version 1)(allow default)(deny file-write* (subpath "${dir}"))`, ...argv], { cwd: dir, input: WRITE, encoding: 'utf8' })
    : execFileSync(bin, argv.slice(1), { cwd: dir, input: WRITE, encoding: 'utf8' });
  return { item: commands(out)[0]!, written: existsSync(join(dir, 'notes.md')) };
}
/** A job to its end. Its first window reading comes after submit, so a runner that refuses Codex shows it as that. */
async function runCodexJob(w: World, kind: 'draft' | 'read', prompt: string): Promise<{ rec: Awaited<ReturnType<World['runner']['wait']>>; stdout: string }> {
  const submitted = await w.runner.submit({ kind, agent: 'codex', prompt, account: ACCOUNT, deadline_ms: 120_000 });
  expect(submitted.refused, 'a Codex job runs; it is not refused before it starts').toBeUndefined();
  const resets = Math.floor((w.clock.now() + 5 * 3_600_000) / 1000);
  await w.runner.report({
    agent: 'codex', account: ACCOUNT,
    rate_limits: {
      limit_id: 'codex', plan_type: 'plus', rate_limit_reached_type: null,
      primary: { used_percent: 5, window_minutes: 300, resets_at: resets },
      secondary: { used_percent: 20, window_minutes: 10080, resets_at: resets + 5 * 86_400 },
    },
  });
  const rec = await w.runner.wait(submitted.job);
  return { rec, stdout: await w.runner.output(submitted.job) };
}

describe('AC26 #39.8807ac2c a Codex job asked to write is refused by the sandbox confining it, and that is its stop cause', () => {
  it('AC26 a Codex job launched by exec --json with its prompt on stdin really fails its write under the sandbox, leaves no file, finishes with stop cause refusal; a command that exits 0 is no refusal', async () => {
    const bin = installStandIn();
    signInCodex();

    // The stand-in is honest: left alone it writes, and under Seatbelt alone, with the same flags, the OS stops it.
    const free = byHand(bin, false);
    expect(free.written, 'the stand-in, unconfined, really writes the file').toBe(true);
    expect(free.item.status).toBe('completed');
    const held = byHand(bin, true);
    expect(held.written, 'the stand-in under a Seatbelt profile leaves no file').toBe(false);
    expect(held.item.status).toBe('failed');
    expect(String(held.item.aggregated_output), 'the error is the operating system\'s').toMatch(OS_REFUSED);

    const w = await openWorld({ loginPath: `${dirname(bin)}:/usr/bin:/bin` });
    try {
      const { rec, stdout } = await runCodexJob(w, 'draft', WRITE);

      // The launch: exec, --json, the prompt on stdin and `-` last; never a sandbox of Codex's own that dies nested.
      const { argv, stdin } = launchOf(stdout);
      expect(argv[0], `the launch: ${argv.join(' ')}`).toBe('exec');
      expect(argv, 'the launch').toContain('--json');
      expect(argv[argv.length - 1], `the prompt comes on stdin: ${argv.join(' ')}`).toBe('-');
      expect(stdin, 'what the job read on stdin').toBe(WRITE);
      expect(argv.join(' '), 'the prompt never rides in its arguments').not.toContain('notes.md');
      expect(argv.join(' '), 'macOS forbids nested Seatbelt: read-only exits 71 under the supervisor').not.toMatch(/(^| )(-s ?|--sandbox[ =])read-only( |$)/);

      // The write really failed, and the operating system is why.
      const write = commands(stdout)[0];
      expect(write, `the job ran its write: ${stdout.slice(0, 2000)}`).toBeDefined();
      expect(write!.status, `the write, as the job saw it: ${JSON.stringify(write)}`).toBe('failed');
      expect(String(write!.aggregated_output), 'the real OS error').toMatch(OS_REFUSED);
      expect(existsSync(join(rec.folder, 'notes.md')), 'the refused write left a file').toBe(false);

      // The refusal is what the job records, on the job and in the record.
      expect(rec.state, JSON.stringify(rec)).toBe('finished');
      expect(rec.stop?.cause, `the job's recorded stop cause: ${JSON.stringify(rec)}`).toBe('refusal');
      const ended = (await w.events('job.ended')).find((e) => e.subject === rec.job);
      expect((ended?.data as Line | undefined)?.cause, 'the record\'s job.ended').toBe('refusal');

      // Wrong program: a command that exits 0 is no refusal.
      const clean = await runCodexJob(w, 'read', 'Say where you are.\n@sh pwd');
      expect(commands(clean.stdout)[0]?.exit_code, `the command ran and exited 0: ${clean.stdout.slice(0, 2000)}`).toBe(0);
      expect(clean.rec.state, JSON.stringify(clean.rec)).toBe('finished');
      expect(clean.rec.stop?.cause, 'a command that exits 0 is no refusal').not.toBe('refusal');
    } finally {
      await w.close();
    }
  }, 180_000);
});
