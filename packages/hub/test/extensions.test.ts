// A loaded extension's tool.before handler answers through the hub's hook reply (#350): a deny ends the call with
// its reason, context goes to the agent, and a handler that fails takes the hook's fail-open policy: the reply deep-hook
// gets is the one it gets with no extension at all, before the hold the hub acknowledged.
import { mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { openAsks } from '@deepbuild/asks';
import { openEvidenceStore } from '@deepbuild/evidence';
import { openExtensionHost, openTrust, packageDigest } from '@deepbuild/extension-host';
import { openRecord } from '@deepbuild/record';
import { openSupervisor } from '@deepbuild/supervisor';
import { hookLine, withHub } from './hub.js';

const SESSION = '6f1c2b9e-1111-4222-8333-444455556666';
const ID = 'test/guard';

/** A hook request as deep-hook writes it, for a Bash call. */
function request(id: string, command: string): string {
  const payload = { session_id: SESSION, cwd: '/tmp', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, tool_use_id: `toolu_${id}` };
  return hookLine(id, 'PreToolUse', payload);
}

/** Sends one hook request the way deep-hook does and reads both lines back: the acknowledgement and the reply. */
function exchange(socket: string, line: string): Promise<{ ack: Record<string, unknown>; reply: Record<string, unknown>; sent: number; replied: number }> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    let got = '';
    let sent = 0;
    sock.on('data', (d) => {
      got += d;
      if (!sent && got.includes('\n')) { sent = Date.now(); sock.write(line); }
    });
    sock.on('end', () => {
      const lines = got.split('\n');
      if (lines.length < 4) return reject(Error(`the hub closed after ${lines.length - 1} line(s): ${got}`));
      resolve({ ack: JSON.parse(lines[1]!) as Record<string, unknown>, reply: JSON.parse(lines[2]!) as Record<string, unknown>, sent, replied: Date.now() });
    });
    sock.on('error', reject);
  });
}

// An outside package: it denies a command that names `deny-me`, sleeps past any deadline on one that names
// `late-me`, and adds one templated block to every other call.
const MANIFEST = {
  id: ID, version: '1.0.0', digest: 'd1:0000000000000000000000000000000000000000000000000000000000000000',
  access: { words: ['record'] },
  templates: [
    { name: 'blocked', hook: 'tool.before', text: 'this is a {what} call', fields: { what: { type: 'one_of', values: ['force-push'] } } },
    { name: 'open', hook: 'tool.before', text: '{count} notes are open', fields: { count: { type: 'number' } } },
  ],
};
const CODE = `export default function (deep: any): void {
  deep.on('tool.before', async (req: any) => {
    const command = String(req?.data?.command ?? '');
    if (command.includes('deny-me')) return { deny: { template: 'blocked', values: { what: 'force-push' } } };
    if (command.includes('late-me')) { await new Promise((r) => setTimeout(r, 10_000)); return null; }
    return { context: { template: 'open', values: { count: 3 } } };
  });
}
`;

/** Installs and checks the package under the hub's home, through the host API, with the hub stopped. */
async function install(home: string, root: string): Promise<void> {
  const from = join(home, 'pkg');
  mkdirSync(from, { recursive: true });
  writeFileSync(join(from, 'index.ts'), CODE);
  writeFileSync(join(from, 'deepbuild.json'), JSON.stringify(MANIFEST));
  writeFileSync(join(from, 'deepbuild.json'), JSON.stringify({ ...MANIFEST, digest: packageDigest(from) }));
  const evidence = await openEvidenceStore({ root: join(home, 'pre', 'evidence') });
  const record = await openRecord({ path: join(home, 'pre', 'ledger.db'), now: Date.now, evidence });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
  const trust = await openTrust({ record, now: Date.now });
  const host = await openExtensionHost({ record, supervisor: sup, trust, home: root, release: [], now: Date.now });
  try {
    await host.ready();
    const pkg = await host.install({ from, builtBy: null, grant: { record: ['tool.before'] } });
    const checked = await host.check(pkg);
    expect(checked.passed, `${ID}'s conformance: ${checked.reasons.join('; ')}`).toBe(true);
  } finally {
    await host.close();
    await sup.close();
    await record.close();
  }
}

describe('an extension on the hub answers tool.before', () => {
  it('denies with its reason, adds context, and a handler past the deadline takes the fail-open reply before the hold', async () => {
    await withHub(async (root, home, hub) => {
      const socket = join(root, 'hub.sock');
      // With no extension loaded, a hook is answered at once, with no hold.
      const bare = await exchange(socket, request('01K74FKZVKZGATTBZAEGPRET80', 'ls'));
      expect(bare.ack.hold_until_ms).toBeNull();
      expect(bare.reply).toMatchObject({ exit: 0, stdout: '', stderr: '' });

      await install(home, root);
      await hub.restart();

      const denied = await exchange(socket, request('01K74FKZVKZGATTBZAEGPRET81', 'git push --force deny-me'));
      expect(denied.ack.hold_until_ms, 'a hook with a handler is held').toBeTypeOf('number');
      expect(denied.reply.exit, 'a deny ends the call').toBe(2);
      expect(String(denied.reply.stderr), 'the agent sees the reason, labelled with the extension').toContain(ID);
      expect(String(denied.reply.stderr)).toContain('this is a force-push call');
      expect(denied.reply.stdout).toBe('');

      const told = await exchange(socket, request('01K74FKZVKZGATTBZAEGPRET82', 'ls'));
      expect(told.reply.exit).toBe(0);
      const out = JSON.parse(String(told.reply.stdout)) as { hookSpecificOutput?: { hookEventName?: string; additionalContext?: string } };
      expect(out.hookSpecificOutput?.hookEventName).toBe('PreToolUse');
      expect(out.hookSpecificOutput?.additionalContext).toContain(ID);
      expect(out.hookSpecificOutput?.additionalContext).toContain('3 notes are open');

      // The handler never answers: the reply is the one a hub with no extension gives, and it comes before the hold.
      const late = await exchange(socket, request('01K74FKZVKZGATTBZAEGPRET83', 'late-me'));
      expect(late.reply, 'a failed handler takes the fail-open policy').toMatchObject({ exit: 0, stdout: '', stderr: '' });
      expect(late.replied - late.sent, 'the handler was given its deadline').toBeGreaterThanOrEqual(500);
      expect(late.replied, 'the reply came before the hold deep-hook was given').toBeLessThan(Number(late.ack.hold_until_ms));

      // Held or not, each hook's event is in the record.
      const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
      try {
        const commands = () => (db.prepare("SELECT json_extract(data, '$.command') AS c FROM events WHERE kind = 'tool.before' ORDER BY log_pos").all() as { c: string }[]).map((r) => r.c);
        for (const until = Date.now() + 3000; Date.now() < until && commands().length < 4; await new Promise((r) => setTimeout(r, 20)));
        expect(commands()).toEqual(['ls', 'git push --force deny-me', 'ls', 'late-me']);
      } finally {
        db.close();
      }
    });
  }, 120_000);
});
