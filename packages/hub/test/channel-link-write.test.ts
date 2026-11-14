// #1906 no-visible-change: linking a channel account replaces its file atomically without gaining a sync requirement.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { Channels } from '../src/channels.js';
import { Devices } from '../src/trusted.js';

it('keeps a channel link when directory fsync is unavailable, as the original atomic writer did', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'channel-link-1906-'));
  const unused = (): never => { throw Error('linking an account does not ask or call a channel'); };
  const channels = new Channels({ root: dir, hub: 'test-hub', now: Date.now, devices: new Devices(join(dir, 'devices.json')), loaded: unused, call: unused, asks: unused, append: unused, answer: unused, cancel: unused });
  const sync = vi.spyOn(fs, 'fsyncSync').mockImplementation(() => { throw Object.assign(Error('unsupported sync'), { code: 'EINVAL' }); });
  syncBuiltinESMExports();
  try {
    expect(() => channels.link('chat', 'one')).not.toThrow();
    expect(() => channels.link('chat', 'two')).not.toThrow();
    expect(JSON.parse(fs.readFileSync(join(dir, 'channel-links.json'), 'utf8'))).toEqual({ chat: ['one', 'two'] });
    expect(fs.existsSync(join(dir, 'channel-links.json.tmp'))).toBe(false);
    expect(fs.statSync(join(dir, 'channel-links.json')).mode & 0o777).toBe(0o600);
  } finally {
    sync.mockRestore();
    syncBuiltinESMExports();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
