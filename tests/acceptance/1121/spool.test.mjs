// AC4 (#1121.23cb368c): deep-hook on aarch64 never writes through a symlinked spool path. The real deep-hook, built
// here, is given a real call with no hub there, so it spools it: first into a home of its own, which shows it spools
// at all, then into homes whose spool file, or spool folder, is a link to somewhere else.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { elsewhere, MINUTES, PLATFORM, run } from './helpers.mjs';

/** Builds deep-hook as the checkout has it, and answers where cargo put it. */
async function built() {
  const { status, stdout, stderr } = await run(['cargo', 'build', '--locked', '-p', 'deep-hook', '--bin', 'deep-hook', '--message-format=json']);
  assert.equal(status, 0, `deep-hook builds on ${PLATFORM}:\n${stderr.split('\n').filter((line) => /^error/.test(line)).join('\n') || stderr.slice(-2000)}`);
  const made = stdout.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line)).find((message) => message.reason === 'compiler-artifact' && message.target?.name === 'deep-hook' && message.executable);
  assert.ok(made, 'cargo names the deep-hook it built');
  return made.executable;
}

/** One PreToolUse call of `ls <word>` through deep-hook with only this home in its environment, and no hub. */
async function call(hook, home, word) {
  const payload = JSON.stringify({ session_id: 's1121', cwd: '/tmp', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: `ls ${word}` } });
  const { signal } = await run([hook, 'claude-code', 'PreToolUse'], { cwd: '/tmp', env: { HOME: home }, input: payload });
  assert.equal(signal, null, 'deep-hook ended by itself');
}

/** A short home (a Unix socket path must fit in 104 bytes), removed after the test. */
function home(t) {
  const dir = mkdtempSync('/tmp/dh1121-');
  mkdirSync(join(dir, '.deepbuild'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const TRIES = 5;

test('#1121.23cb368c deep-hook on aarch64 refuses a symlinked spool path: the file it leads to is never written', MINUTES, async (t) => {
  if (process.arch !== 'arm64') return t.skip(elsewhere('aarch64'));
  const hook = await built();

  // deep-hook gives the spool 45 ms, so a busy machine can lose a line: a home of its own must get one in five calls.
  const plain = home(t);
  const spool = join(plain, '.deepbuild/spool/spool.jsonl');
  for (let n = 0; n < TRIES && !(existsSync(spool) && readFileSync(spool, 'utf8').includes('ls t1121-plain')); n++) await call(hook, plain, 't1121-plain');
  if (!existsSync(spool) || !readFileSync(spool, 'utf8').includes('ls t1121-plain')) return t.skip(`INCONCLUSIVE: deep-hook spooled none of ${TRIES} calls into ${spool} on this machine, so a spool it leaves alone proves nothing`);

  for (const kind of ['file', 'folder']) {
    const linked = home(t), outside = home(t);
    const target = join(outside, 'spool.jsonl');
    writeFileSync(target, 'untouched\n');
    const folder = join(linked, '.deepbuild/spool');
    let link;
    if (kind === 'folder') symlinkSync(outside, link = folder);
    else {
      mkdirSync(folder, { mode: 0o700 });
      symlinkSync(target, link = join(folder, 'spool.jsonl'));
    }
    for (let n = 0; n < TRIES; n++) await call(hook, linked, `t1121-${kind}-${n}`);
    const after = readFileSync(target, 'utf8');
    assert.equal(after, 'untouched\n', `deep-hook on ${PLATFORM} followed the symlinked spool ${kind} ${link} and wrote the file it leads to, ${target}:\n${after.slice(0, 600)}`);
  }
});
