// A view's panel held to panel@1 (#326, #1454). The kit draws the panel headless, so it runs in the checkout's build of
// the replica, as deep_drive does. Gpui-shell writes files beside a script it runs, so it runs on a copy: the installed
// bytes stay the ones their digest names. Unrun is never a pass: a kit that can't run reads BLOCKED, and the app doesn't
// mount the panel.
import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** How long a panel gets to mount, run for its half second and be read. */
const KIT_MS = 30_000;

export interface PanelKit { verdict: 'PASS' | 'FAIL' | 'BLOCKED'; why: string }

/** The replica's binary: the checkout's debug build, as deep_drive runs it. */
const replica = (): string => join(fileURLToPath(new URL('../../../', import.meta.url)), 'target', 'debug', 'deep-replica');

export async function panelKit(panel: string): Promise<PanelKit> {
  const bin = replica();
  if (!existsSync(bin)) return { verdict: 'BLOCKED', why: `no replica is built at ${bin}; run cargo build -p deep-replica --bin deep-replica first` };
  const copy = mkdtempSync(join(tmpdir(), 'deep-panel-'));
  try {
    cpSync(panel, copy, { recursive: true });
    const out = await new Promise<string>((done) => {
      execFile(bin, ['--panel-kit', copy], { timeout: KIT_MS }, (_, stdout) => done(stdout));
    });
    const line = out.trim().split('\n').pop() ?? '';
    let said: { result?: string; names?: string };
    try { said = JSON.parse(line) as typeof said; } catch { return { verdict: 'BLOCKED', why: `the kit gave no verdict: ${line.slice(0, 200)}` }; }
    return said.result === 'pass' ? { verdict: 'PASS', why: '' } : { verdict: 'FAIL', why: said.names ?? 'it failed' };
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}
