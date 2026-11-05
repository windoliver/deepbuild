import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { programRoot } from '../src/runner.js';
// Codex's versions and windows in the runner (#39): a build its facts don't list isn't covered by a listed build's
// numbers, and a window is the one its length says, as the hub's row reads it.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { seatbelt } from '@deepbuild/supervisor';
import { codexLogRefused, codexReach, codexRefused, codexSignIn, codexWindows, shownVersion } from '../src/runner.js';

describe('the version Codex shows', () => {
  it('keeps its suffix where versions are exact, so a stable build is not its alpha', () => {
    expect(shownVersion('codex-cli 0.163.0-alpha.10.2\n', true)).toBe('0.163.0-alpha.10.2');
    expect(shownVersion('codex-cli 0.163.0\n', true)).toBe('0.163.0');
  });
  it('stays the three numbers for an agent whose facts are a range', () => {
    expect(shownVersion('2.1.142-beta (Claude Code)\n', false)).toBe('2.1.142');
  });
});

describe('Codex\'s windows', () => {
  it('are named by length, with the slot only where a snapshot gives none', () => {
    const weekFirst = codexWindows({ limit_id: 'codex', primary: { used_percent: 40, window_minutes: 10080 } });
    expect([...weekFirst.keys()]).toEqual(['seven_day']);
    const named = codexWindows({ primary: { used_percent: 1, window_minutes: 300 }, secondary: { used_percent: 2, window_minutes: 10080 } });
    expect(named.get('five_hour')?.used).toBe(1);
    expect(named.get('seven_day')?.used).toBe(2);
    expect([...codexWindows({ primary: { used_percent: 1 }, secondary: { used_percent: 2 } }).keys()]).toEqual(['five_hour', 'seven_day']);
  });
});

describe('what counts as a refusal', () => {
  const ran = (command: string, status = 'failed') => ({ type: 'command_execution', command, status, aggregated_output: 'Operation not permitted' });
  it('is a write the sandbox stopped, or a patch declined', () => {
    expect(codexRefused(ran("/bin/sh -c 'printf x > out.txt'"))).toBe(true);
    expect(codexRefused(ran('touch out.txt'))).toBe(true);
    expect(codexRefused({ type: 'file_change', status: 'declined' })).toBe(true);
  });
  it('is not a read that failed the same way, nor a command that ran', () => {
    expect(codexRefused(ran('cat /private/secret'))).toBe(false);
    expect(codexRefused(ran('cat /private/secret 2>/dev/null'))).toBe(false);
    expect(codexRefused(ran('touch out.txt', 'completed'))).toBe(false);
  });
});

describe('an agent installed as a package', () => {
  it('has its whole package readable, since its launcher in bin loads the rest from there', () => {
    const pkg = realpathSync(mkdtempSync(join(tmpdir(), 'deep-pkg-')));
    mkdirSync(join(pkg, 'bin'));
    writeFileSync(join(pkg, 'package.json'), '{"bin":{"codex":"bin/codex.js"}}');
    writeFileSync(join(pkg, 'bin', 'codex.js'), '');
    expect(programRoot(join(pkg, 'bin', 'codex.js'))).toBe(pkg);
    rmSync(pkg, { recursive: true });
  });
  it('is only its own folder when no package holds it', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-bare-')));
    writeFileSync(join(dir, 'codex'), '');
    expect(programRoot(join(dir, 'codex'))).toBe(dir);
    rmSync(dir, { recursive: true });
  });
});

describe('A Codex job in its sandbox', () => {
  // Its HTTP client can't load the system's roots in there: every request failed as "workspace routing discovery failed".
  it('is told a root certificate file it can read there', async () => {
    const temp = realpathSync(mkdtempSync(join(tmpdir(), 'codex-roots-')));
    try {
      const env = codexReach({ temp, proxy: 'http://127.0.0.1:1', home: '', env: {} });
      const read = codexSignIn(temp, {});
      const { argv, cwd } = await seatbelt.confine({ argv: ['/bin/cat', env.SSL_CERT_FILE!], cwd: temp, env }, { read, write: [temp] });
      expect(execFileSync(argv[0]!, argv.slice(1), { cwd, encoding: 'utf8', maxBuffer: 1 << 24 })).toContain('BEGIN CERTIFICATE');
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });
});

// The shape 0.160.0 writes (live run): its --json carries no item for a shell command, only its session log does.
const logged = (cmd: string, code: number, output: string): string => [
  { type: 'response_item', payload: { type: 'custom_tool_call', call_id: 'c1', name: 'exec', input: `text(await tools.exec_command({cmd:${JSON.stringify(cmd)},"max_output_tokens":1000}));\n` } },
  { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'c1', output: [{ type: 'input_text', text: 'Script completed\n' }, { type: 'input_text', text: JSON.stringify({ exit_code: code, output }) }] } },
].map((l) => JSON.stringify(l)).join('\n');

describe('A Codex session log', () => {
  it('shows a write the sandbox stopped', () => {
    expect(codexLogRefused(logged("printf 'hello\\n' > out.txt", 71, 'sandbox-exec: sandbox_apply: Operation not permitted\n'))).toBe(true);
    expect(codexLogRefused(logged("printf 'hello\\n' > out.txt", 1, '/bin/bash: out.txt: Operation not permitted\n'))).toBe(true);
  });
  it('shows no refusal for a read stopped the same way, a write that ran, or a broken line', () => {
    expect(codexLogRefused(logged('cat secret', 1, 'cat: secret: Operation not permitted\n'))).toBe(false);
    expect(codexLogRefused(logged('echo hi > out.txt', 0, ''))).toBe(false);
    expect(codexLogRefused('{not json\n')).toBe(false);
  });
  it('joins a result to its own call, not to another call in the log', () => {
    const write = logged('echo hi > out.txt', 0, '');
    const read = logged('cat secret', 1, 'cat: secret: Operation not permitted\n').replaceAll('c1', 'c2');
    expect(codexLogRefused(`${write}\n${read}`)).toBe(false);
  });
  it('reads a command written as any script literal, and never throws on one JSON would refuse', () => {
    const script = (input: string) => [
      { payload: { type: 'custom_tool_call', call_id: 'c', name: 'exec', input } },
      { payload: { type: 'custom_tool_call_output', call_id: 'c', output: [{ type: 'input_text', text: JSON.stringify({ exit_code: 71, output: 'Operation not permitted' }) }] } },
    ].map((l) => JSON.stringify(l)).join('\n');
    expect(codexLogRefused(script('tools.exec_command({cmd:"echo \\$HOME > out"})'))).toBe(true);
    expect(codexLogRefused(script("tools.exec_command({cmd:'touch x'})"))).toBe(true);
    expect(codexLogRefused(script('tools.exec_command({cmd:`touch x`})'))).toBe(true);
    expect(codexLogRefused(script('tools.exec_command({cmd:"echo hi 1>out"})'))).toBe(true);
  });
  it('takes a stopped command it cannot read as refused, since it cannot say it was only a read', () => {
    const input = 'tools.exec_command({cmd: c})';
    const log = [{ payload: { type: 'custom_tool_call', call_id: 'c', name: 'exec', input } }, { payload: { type: 'custom_tool_call_output', call_id: 'c', output: [{ type: 'input_text', text: JSON.stringify({ exit_code: 71, output: 'Operation not permitted' }) }] } }].map((l) => JSON.stringify(l)).join('\n');
    expect(codexLogRefused(log)).toBe(true);
  });
  it('is no refusal when the command succeeded though its output says the words, or when the write is only quoted text', () => {
    expect(codexLogRefused(logged('ls -R ~/Library > $TMPDIR/l; cat $TMPDIR/l', 0, 'ls: Operation not permitted\n'))).toBe(false);
    expect(codexLogRefused(logged('grep "a -> b" f', 71, 'sandbox-exec: sandbox_apply: Operation not permitted\n'))).toBe(false);
    expect(codexLogRefused(logged("grep 'rm ' f", 71, 'sandbox-exec: sandbox_apply: Operation not permitted\n'))).toBe(false);
  });
  it('reads each line of a command of many lines', () => {
    expect(codexLogRefused(logged('cd x\ntouch y', 71, 'sandbox-exec: sandbox_apply: Operation not permitted\n'))).toBe(true);
  });
});

describe('A program whose folder sits under some other package', () => {
  it('has only its own folder readable: that package does not own it', () => {
    const top = realpathSync(mkdtempSync(join(tmpdir(), 'program-')));
    try {
      mkdirSync(join(top, 'bin'));
      writeFileSync(join(top, 'bin', 'codex'), '');
      writeFileSync(join(top, 'package.json'), '{"name":"home"}');
      expect(programRoot(join(top, 'bin', 'codex'))).toBe(join(top, 'bin'));
    } finally { rmSync(top, { recursive: true, force: true }); }
  });
});
