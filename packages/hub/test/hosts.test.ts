// The hosts your SSH config names (#1942): a Host line's literal names, through its Include lines, and never a pattern.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { Hosts } from '../src/hosts.js';

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it('names each literal Host name, through Include lines, and no pattern', () => {
  dir = mkdtempSync(join(tmpdir(), 'deep-hosts-'));
  mkdirSync(join(dir, 'more'));
  writeFileSync(join(dir, 'more', 'lab'), 'Host gpu-box pi4\n  HostName 10.0.0.4\nHost !nope *.lan\n');
  writeFileSync(join(dir, 'config'), `Include ${join(dir, 'more', 'lab')}\nHost build-01 "lab 2"\n  Port 2222\nHost=eq\nHost *\n  User you\nMatch host x\n`);
  const hosts = new Hosts({ root: dir, now: Date.now, plant: undefined, raise: () => Promise.reject(Error('no asks')) });
  expect(hosts.names(join(dir, 'config')).sort()).toEqual(['build-01', 'eq', 'gpu-box', 'lab 2', 'pi4'].sort());
});
