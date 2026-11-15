// #2538 AC3: on Linux, every item `HOME=<empty fixture dir> node packages/cli/dist/main.js doctor --json` prints
// carries a code doctor.item@1 lists. The built CLI is run for real, as the issue's reproduction runs it, with HOME
// an empty temp folder; the codes are compared with the schema file's enum.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listedCodes, REPO } from './helpers.ts';

const LINUX = process.platform === 'linux';

// Off Linux this is skipped by name, which vitest reports as skipped and never as passed: the criterion is Linux's
// (hub.polkit is a Linux item), and a run elsewhere proves nothing of it.
describe.skipIf(!LINUX)('#2538.8e3e2618 AC3: on Linux, every item `HOME=<empty fixture dir> node packages/cli/dist/main.js doctor --json` prints carries a code `doctor.item@1` lists (Linux only: skipped, not passed, on any other platform)', () => {
  it('#2538.8e3e2618 AC3: every line doctor --json prints under an empty HOME is an item whose code the schema file lists, hub.polkit\'s among them', () => {
    const cli = join(REPO, 'packages', 'cli', 'dist', 'main.js');
    expect(existsSync(cli), 'packages/cli/dist/main.js is not built; run npm run build --workspaces').toBe(true);
    const home = mkdtempSync(join(tmpdir(), 'deep-2538-home-'));
    try {
      const ran = spawnSync(process.execPath, [cli, 'doctor', '--json'], { cwd: REPO, env: { ...process.env, HOME: home }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 150_000 });
      if (ran.error) throw ran.error;
      expect(ran.signal, ran.stderr).toBeNull();
      // Doctor exits 1 or 3 on an empty home (items fail, others aren't checked); a crash prints no items.
      const items = ran.stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line) as { item: string; code: string });
      expect(items.length, ran.stderr).toBeGreaterThan(0);
      // Linux's own item is there, so the run did reach the code the issue's reproduction shows.
      expect(items.map((i) => i.item)).toContain('hub.polkit');
      const listed = new Set(listedCodes());
      expect(items.filter((i) => !listed.has(i.code)).map((i) => `${i.item}: ${i.code}`)).toEqual([]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 180_000);
});
