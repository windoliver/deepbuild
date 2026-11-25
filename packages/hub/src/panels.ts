// A view's panel held to panel@1 (#326, #1454). The kit draws the panel headless, so it runs in the checkout's build of
// the replica, as deep_drive does. Gpui-shell writes files beside a script it runs, so it runs on a copy: the installed
// bytes stay the ones their digest names. Unrun is never a pass: a kit that can't run reads BLOCKED, and the app doesn't
// mount the panel.
import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** How long a panel gets to mount, run for its half second and be read. */
const KIT_MS = 30_000;

/** What the kit said, the revision it held the panel to, and for one read at an earlier revision what the current one would refuse in it, empty when nothing (#3233). */
interface PanelKit { verdict: 'PASS' | 'FAIL' | 'BLOCKED'; why: string; revision?: number; reading?: string }
/** The installer's record of the kit revision a panel was installed against, beside its script in the copy the kit runs. */
const RECORD = 'panel-kit.json';

/** The replica's binary: the checkout's debug build, as deep_drive runs it. */
const replica = (): string => join(fileURLToPath(new URL('../../../', import.meta.url)), 'target', 'debug', 'deep-replica');

/** `installedAt` is the kit revision an installed panel passed before, which it stays held to; without it the panel is held to the current one. */
export async function panelKit(panel: string, installedAt?: number): Promise<PanelKit> {
  const bin = replica();
  if (!existsSync(bin)) return { verdict: 'BLOCKED', why: `no replica is built at ${bin}; run cargo build -p deep-replica --bin deep-replica first` };
  const copy = mkdtempSync(join(tmpdir(), 'deep-panel-'));
  try {
    cpSync(panel, copy, { recursive: true });
    // The record of an earlier install is the installer's to write, never a package's own (#3233).
    rmSync(join(copy, RECORD), { force: true });
    if (installedAt !== undefined) writeFileSync(join(copy, RECORD), JSON.stringify({ slot: 'panel@1', revision: installedAt }));
    const out = await new Promise<string>((done) => {
      execFile(bin, ['--panel-kit', copy], { timeout: KIT_MS }, (_, stdout) => done(stdout));
    });
    const line = out.trim().split('\n').pop() ?? '';
    let said: { result?: string; names?: string; revision?: number };
    try { said = JSON.parse(line) as typeof said; } catch { return { verdict: 'BLOCKED', why: `the kit gave no verdict: ${line.slice(0, 200)}` }; }
    const revision = typeof said.revision === 'number' ? { revision: said.revision } : {};
    if (said.result !== 'pass') return { verdict: 'FAIL', why: said.names ?? 'it failed', ...revision };
    return { verdict: 'PASS', why: '', ...revision, ...(installedAt !== undefined ? { reading: said.names ?? '' } : {}) };
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}
