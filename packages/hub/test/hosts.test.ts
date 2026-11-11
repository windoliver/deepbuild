// The hosts your SSH config names (#1942): a Host line's literal names, through its Include lines, and never a pattern.
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { Hosts } from '../src/hosts.js';
import { deep, withHub } from './hub.js';

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it('names each literal Host name, through Include lines, and no pattern', () => {
  dir = mkdtempSync(join(tmpdir(), 'deep-hosts-'));
  mkdirSync(join(dir, 'more'));
  writeFileSync(join(dir, 'more', 'lab'), 'Host gpu-box pi4\n  HostName 10.0.0.4\nHost !nope *.lan\n');
  writeFileSync(join(dir, 'config'), `Include ${join(dir, 'more', 'lab')}\nHost build-01 "lab 2"\n  Port 2222\nHost=eq\nHost *\n  User you\nMatch host x\n`);
  const hosts = new Hosts({ root: dir, now: Date.now, plant: undefined, raise: () => Promise.reject(Error('no asks')), append: async () => undefined, put: async () => '', raw: async () => [] });
  expect(hosts.names(join(dir, 'config')).sort()).toEqual(['build-01', 'eq', 'gpu-box', 'lab 2', 'pi4'].sort());
});

// `deep host list | facts`: the commands that send host.list and host.facts, which nothing sent. ssh is the boundary:
// a stand-in on the hub's PATH answers the facts script as a host would.
it('deep host list names the hosts your SSH config names, and deep host facts reads one over SSH', async () => {
  dir = mkdtempSync(join(tmpdir(), 'deep-hosts-'));
  writeFileSync(join(dir, 'ssh'), "#!/bin/sh\ncat > /dev/null\nprintf 'kernel\\t6.8.0\\narch\\taarch64\\ncores\\t8\\nmemory_kb\\t1024\\n'\n");
  chmodSync(join(dir, 'ssh'), 0o755);
  await withHub(async (_root, home) => {
    mkdirSync(join(home, '.ssh'));
    writeFileSync(join(home, '.ssh', 'config'), 'Host gpu-box\n  HostName 10.0.0.4\nHost *.lan\n  User you\n');
    expect(await deep(home, home, ['host', 'list'])).toEqual({ code: 0, stdout: 'gpu-box\n', stderr: '' });

    const read = await deep(home, home, ['host', 'facts', 'gpu-box']);
    expect(read.code, read.stderr).toBe(0);
    const reply = JSON.parse(read.stdout) as { host: string; facts: { system: { value: object } } };
    expect(reply.host).toBe('gpu-box');
    expect(reply.facts.system.value).toMatchObject({ kernel: '6.8.0', arch: 'aarch64', cores: 8, memory_bytes: 1024 * 1024 });

    const unnamed = await deep(home, home, ['host', 'facts', 'nas']);
    expect(unnamed.code, unnamed.stdout).toBe(1);
    expect(unnamed.stderr).toContain("nas isn't a host your SSH config");

    for (const args of [['list', 'all'], ['facts'], ['facts', '--refresh'], ['facts', 'gpu-box', '--now']]) {
      const ran = await deep(home, home, ['host', ...args]);
      expect(ran.code, `deep host ${args.join(' ')}: ${ran.stderr}`).toBe(2);
      expect(ran.stderr).toContain('deep host facts <host> [--refresh]');
    }
  }, { PATH: `${dir}:${process.env.PATH}` });
}, 120_000);
