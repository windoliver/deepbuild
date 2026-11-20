// #2960.e48f6fa4: a count run through an x86_64 cargo or a translated shell reads BLOCKED naming which binary, not a
// dyld abort.
//   node --test tests/acceptance/2960/x86-blocked.test.mjs       # an Apple silicon Mac with Rosetta
// Asserts, per run: the reading is BLOCKED (measureOnce throws a message saying BLOCKED, or returns one in its own
// fields with no count) and names the binary: (a) an x86_64-only program named cargo, built here; (b) this Mac's
// ~/.cargo/bin/cargo when it is an x86_64 rustup proxy, named by its path or what it links to; (c) a run started from
// `arch -x86_64 /bin/sh`, a shell under Rosetta, of a universal program, which then starts as x86_64: named by that
// program's path or by /bin/sh. On the merge base each is a dyld abort ("incompatible architecture (have 'arm64', need
// 'x86_64')", "time: command terminated abnormally") read as a count. No system setting is changed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { HERE, archsOf, blockedNaming, build, reading, remove, rosetta, shown, tempDir } from './lib.mjs';

const APPLE_SILICON = process.platform === 'darwin' && process.arch === 'arm64';
const skip = !APPLE_SILICON ? `INCONCLUSIVE: criterion #2960.e48f6fa4 is an Apple silicon Mac's; this host is ${process.platform} ${process.arch}`
  : !rosetta() ? 'INCONCLUSIVE: Rosetta is not installed, so nothing here runs as x86_64' : false;

describe('#2960 an x86_64 binary in a count reads BLOCKED', { skip, timeout: 600_000 }, () => {
  let dir, cargo, universal;
  before(() => {
    dir = tempDir();
    cargo = build(dir, 'tool', ['x86_64'], 'cargo');
    universal = build(dir, 'tool', ['arm64', 'x86_64'], 'universal-tool');
  });
  after(() => dir && remove(dir));

  it('#2960.e48f6fa4 a count run through an x86_64 cargo reads BLOCKED naming it', async () => {
    const read = await reading([cargo, '--version']);
    assert.ok(blockedNaming(read, [cargo, 'cargo']), `measureOnce of an x86_64-only ${cargo} --version must read BLOCKED naming it, not abort in dyld. ${shown(read)}`);
  });

  const proxy = join(homedir(), '.cargo/bin/cargo');
  const isProxy = existsSync(proxy) && archsOf(proxy).join(' ') === 'x86_64';
  it('#2960.e48f6fa4 a count run through this Mac\'s x86_64 rustup cargo reads BLOCKED naming it', { skip: isProxy ? false : 'INCONCLUSIVE: ~/.cargo/bin/cargo is missing or not an x86_64-only binary here' }, async () => {
    const read = await reading([proxy, '--version']);
    assert.ok(blockedNaming(read, [proxy, realpathSync(proxy), 'cargo', basename(realpathSync(proxy))]), `measureOnce of the x86_64 rustup proxy ~/.cargo/bin/cargo --version must read BLOCKED naming it, not abort in dyld. ${shown(read)}`);
  });

  it('#2960.e48f6fa4 a count run from a translated shell reads BLOCKED naming the binary', async () => {
    const translated = spawnSync('arch', ['-x86_64', '/bin/sh', '-c', 'sysctl -n sysctl.proc_translated'], { encoding: 'utf8' }).stdout?.trim();
    if (translated !== '1') assert.fail(`BLOCKED: arch -x86_64 /bin/sh doesn't run translated here (sysctl.proc_translated ${JSON.stringify(translated)})`);
    // The shell stays the probe's parent: it runs the probe and then exits with its status.
    const ran = spawnSync('arch', ['-x86_64', '/bin/sh', '-c', '"$0" "$1" "$2"; exit $?', process.execPath, join(HERE, 'probe.mjs'), universal], { encoding: 'utf8', timeout: 300_000 });
    let read;
    try {
      read = JSON.parse(ran.stdout.trim().split('\n').at(-1));
    } catch {
      assert.fail(`BLOCKED: the probe started from a translated /bin/sh printed no reading (exit ${ran.status}): ${(ran.stdout + ran.stderr).slice(-1500)}`);
    }
    assert.ok(blockedNaming(read, [universal, 'universal-tool', '/bin/sh']), `measureOnce run from a translated /bin/sh, of the universal ${universal} (which then starts as x86_64), must read BLOCKED naming the binary, not abort in dyld. ${shown(read)}`);
  });
});
