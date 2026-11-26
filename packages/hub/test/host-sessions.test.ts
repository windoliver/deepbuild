// Sessions on a host (#999), with the host link as the boundary: a stand-in host that keeps the files written to it
// and answers the scripts as a Linux host does. What `deep host add` writes and records, what it leaves alone, and
// what the link's going down and coming back do.
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { addedHosts, hostKey, HostSessions } from '../src/host-sessions.js';
import { Refused } from '../src/wire.js';

const HOME = '/home/you';
const sha = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
type Obj = Record<string, unknown>;

/** A host that holds files under its home and a spool, and says what each script of host-sessions.ts asks of it. */
function world() {
  const root = mkdtempSync(join(tmpdir(), 'deep-host-sessions-'));
  writeFileSync(join(root, 'rules.json'), '{"v":1,"entries":{}}\n');
  writeFileSync(join(root, 'deep-hook-linux'), 'the deep-hook a linux host runs');
  const files = new Map<string, { bytes: Buffer; mode: string }>();
  const spool: [string, string][] = [];
  const calls: string[] = [];
  const events: { kind: string; data: Obj }[] = [];
  const unknown: string[] = [];
  const replayed: { host: string; names: string[] }[] = [];
  let sessions: { id: string; agent: string | null; status: string }[] = [];
  const ran = (stdout: string) => Promise.resolve({ code: 0, stdout, stderr: '' });
  const answer = (args: string[], script: string) => {
    if (script.includes("printf 'home")) {
      return ran([`home\t${HOME}`, 'machine\tLinux aarch64',
        ...['.deepbuild/bin/deep-hook', '.deepbuild/rules.json'].flatMap((p) => (files.has(p) ? [`has\t${p}\t${sha(files.get(p)!.bytes)}`] : [])),
        ...['.claude/settings.json', '.deepbuild/config.json'].flatMap((p) => (files.has(p) ? [`text\t${p}\t${files.get(p)!.mode}\t${files.get(p)!.bytes.toString('base64')}`] : []))].join('\n'));
    }
    if (script.includes('--contract')) return ran('version\t0.0.0\ncontract\t1.0\n');
    if (script.includes('originals')) { calls.push(`keep ${args[0]!}`); files.set(`.deepbuild/originals/${args[1]!}`, files.get(args[0]!)!); return ran(''); }
    if (script.includes('taken-$1')) { calls.push('take'); return ran(spool.map(([name, text]) => `file\t${name}\t${Buffer.from(text).toString('base64')}`).join('\n')); }
    if (script.includes('rm -f "$d/$f"')) {
      // Each file is here, synced, before it goes there.
      calls.push(`drop ${args.join(' ')} with ${readdirSync(join(root, 'spool', 'hosts', hostKey('gpu-box'))).sort().join(' ')} here`);
      spool.splice(0, spool.length, ...spool.filter(([name]) => !args.includes(name)));
      return ran('');
    }
    throw Error(`a script the stand-in host doesn't know: ${script.slice(0, 60)}`);
  };
  const sessionsOn = new HostSessions({
    root, contract: '1.0', hook: (arch) => { calls.push(`hook ${arch}`); return join(root, 'deep-hook-linux'); },
    hosts: {
      named: (host) => { if (host !== 'gpu-box') throw Error(`${String(host)} isn't a host your SSH config names`); return host; },
      granted: async () => { calls.push('granted'); },
      read: (_host, args, script) => answer(args, script),
      exec: (_host, args, script) => answer(args, script),
      put: (_host, path, bytes, mode) => { calls.push(`put ${path} ${mode}`); files.set(path, { bytes: Buffer.from(bytes), mode }); return ran(''); },
    },
    append: async (kind, data) => { events.push({ kind, data }); },
    raw: async () => sessions,
    replay: async (host, dir) => { replayed.push({ host, names: readdirSync(dir).sort() }); for (const name of readdirSync(dir)) rmSync(join(dir, name)); },
    on: () => undefined,
    unknown: async (session) => { unknown.push(session); },
  });
  return { root, files, spool, calls, events, unknown, replayed, sessionsOn, sessions: (rows: typeof sessions) => { sessions = rows; }, json: (path: string) => JSON.parse(files.get(path)!.bytes.toString('utf8')) as Obj };
}

let made: string[] = [];
const fresh = () => { const w = world(); made.push(w.root); return w; };
afterEach(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); made = []; });

it('deep host add installs deep-hook, the guard entries, the forwarded setting and the hook entries, each a host change with its undo', async () => {
  const w = fresh();
  const added = await w.sessionsOn.add('gpu-box');
  expect(added).toEqual({ host: 'gpu-box', home: HOME, socket: `${HOME}/.deepbuild/hub.sock`, hook: `${HOME}/.deepbuild/bin/deep-hook`, version: '0.0.0', contract: '1.0', changed: 4 });
  // Your yes to changes as you comes before anything is read or written there, and the binary is the host's machine's.
  expect(w.calls).toEqual(['granted', 'hook arm64', 'put .deepbuild/bin/deep-hook 755', 'put .deepbuild/rules.json 600', 'put .deepbuild/config.json 600', 'put .claude/settings.json 600']);
  expect(w.files.get('.deepbuild/bin/deep-hook')!.bytes.toString()).toBe('the deep-hook a linux host runs');
  expect(w.json('.deepbuild/config.json')).toEqual({ hub: { forwarded: true } });
  const hooks = w.json('.claude/settings.json').hooks as Record<string, { hooks: { command: string }[] }[]>;
  expect(hooks.PreToolUse![0]!.hooks[0]!.command).toBe(`exec '${HOME}/.deepbuild/bin/deep-hook' claude-code PreToolUse`);
  expect(Object.keys(hooks)).toEqual(expect.arrayContaining(['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SessionEnd']));
  expect(w.events.map((e) => e.kind)).toEqual(['host.changed', 'host.changed', 'host.changed', 'host.changed']);
  expect(w.events[0]!.data).toEqual({
    host: 'gpu-box', change: "Install deep-hook on gpu-box, the program its agents' hooks run", changes: [`${HOME}/.deepbuild/bin/deep-hook`], undo: `rm -f '${HOME}/.deepbuild/bin/deep-hook'`,
    grant: 'you', fingerprint: [{ target: `${HOME}/.deepbuild/bin/deep-hook`, sha256: sha('the deep-hook a linux host runs') }], ask: null, run: null,
  });
  expect(addedHosts(w.root)['gpu-box']).toMatchObject({ home: HOME, version: '0.0.0', contract: '1.0', hubContract: '1.0' });
});

it('writes and records nothing a second time, when the host already holds each file as it would write it', async () => {
  const w = fresh();
  await w.sessionsOn.add('gpu-box');
  w.calls.length = 0;
  w.events.length = 0;
  expect((await w.sessionsOn.add('gpu-box')).changed).toBe(0);
  expect(w.calls).toEqual(['granted', 'hook arm64']);
  expect(w.events).toEqual([]);
});

it('adds its hook entries beside yours, keeps your settings as they were for the undo, and leaves a file that is no JSON as it is', async () => {
  const w = fresh();
  const yours = `${JSON.stringify({ model: 'opus', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'my-guard' }] }] } })}\n`;
  w.files.set('.claude/settings.json', { bytes: Buffer.from(yours), mode: '644' });
  // A host that ran a hub of its own holds guard entries of its own: kept too, never removed by the undo.
  w.files.set('.deepbuild/rules.json', { bytes: Buffer.from('{"v":1,"entries":{"its-own":{}}}\n'), mode: '600' });
  await w.sessionsOn.add('gpu-box');
  expect(w.events.find((e) => (e.data.changes as string[])[0] === `${HOME}/.deepbuild/rules.json`)!.data.undo).toBe(`mv -f '${HOME}/.deepbuild/originals/${sha('{"v":1,"entries":{"its-own":{}}}\n')}' '${HOME}/.deepbuild/rules.json'`);
  const settings = w.json('.claude/settings.json');
  expect(settings.model).toBe('opus');
  const pre = (settings.hooks as Record<string, { hooks: { command: string }[] }[]>).PreToolUse!.flatMap((g) => g.hooks.map((h) => h.command));
  expect(pre).toEqual(['my-guard', `exec '${HOME}/.deepbuild/bin/deep-hook' claude-code PreToolUse`]);
  expect(w.calls).toContain('keep .claude/settings.json');
  expect(w.calls).toContain('put .claude/settings.json 644');
  expect(w.files.get(`.deepbuild/originals/${sha(yours)}`)!.bytes.toString()).toBe(yours);
  expect(w.events.at(-1)!.data.undo).toBe(`mv -f '${HOME}/.deepbuild/originals/${sha(yours)}' '${HOME}/.claude/settings.json'`);

  const broken = fresh();
  broken.files.set('.claude/settings.json', { bytes: Buffer.from('{ not json'), mode: '644' });
  const refused = await broken.sessionsOn.add('gpu-box').catch((error: unknown) => error);
  expect(refused).toBeInstanceOf(Refused);
  expect((refused as Refused).refusal.remediation).toMatch(/^BLOCKED: ~\/\.claude\/settings\.json on gpu-box isn't a JSON object/);
  expect(broken.calls.filter((c) => c.startsWith('put'))).toEqual([]);
  expect(broken.files.get('.claude/settings.json')!.bytes.toString()).toBe('{ not json');
  expect(existsSync(join(broken.root, 'host-sessions.json'))).toBe(false);
});

it('a host your SSH config does not name is refused before your yes is asked or anything reaches it', async () => {
  const w = fresh();
  await expect(w.sessionsOn.add('stranger')).rejects.toThrow("stranger isn't a host your SSH config names");
  expect(w.calls).toEqual([]);
});

it('a link that goes down marks only the sessions at work or waiting unknown, and records why', async () => {
  const w = fresh();
  w.sessions([{ id: 'working', agent: 'claude-code', status: 'working' }, { id: 'waiting', agent: 'claude-code', status: 'waiting' }, { id: 'done', agent: 'claude-code', status: 'finished' }]);
  await w.sessionsOn.link('gpu-box', 'down', 'the link to gpu-box ended (ssh exit 255)');
  expect(w.unknown).toEqual(['working', 'waiting']);
  expect(w.events).toEqual([{ kind: 'host.link', data: { host: 'gpu-box', up: false, why: 'the link to gpu-box ended (ssh exit 255)', hook_version: null, hook_contract: null, hub_version: null, hub_contract: null } }]);
  expect(w.calls).toEqual([]);
});

it('a link that comes back takes the host\'s spool before it settles: each file here before it is dropped there, then replayed as that host\'s', async () => {
  const w = fresh();
  await w.sessionsOn.add('gpu-box');
  w.calls.length = 0;
  w.events.length = 0;
  w.spool.push(['taken-01K74FKZVK8Q2X5R7M3N9P4T6W.jsonl', '{"v":1,"agent":"claude-code","id":"a"}\n{"v":1,"agent":"claude-code","id":"b"}\n'], ['not-a-spool-file', 'x']);
  await w.sessionsOn.link('gpu-box', 'up', '');
  expect(w.events[0]).toEqual({ kind: 'host.link', data: { host: 'gpu-box', up: true, why: null, hook_version: '0.0.0', hook_contract: '1.0', hub_version: expect.any(String) as string, hub_contract: '1.0' } });
  // One pass brought the file, the next found none: nothing is taken twice, and a name that is no spool file is left.
  expect(w.calls).toEqual(['take', 'drop taken-01K74FKZVK8Q2X5R7M3N9P4T6W.jsonl with taken-01K74FKZVK8Q2X5R7M3N9P4T6W.jsonl here', 'take']);
  expect(w.replayed).toEqual([{ host: 'gpu-box', names: ['taken-01K74FKZVK8Q2X5R7M3N9P4T6W.jsonl'] }]);
  expect(w.unknown).toEqual([]);
});
