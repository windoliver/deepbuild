// The soak runner as AC18 #41.8d96c961's tests drive it; the surface it assumes is pinned in soak-pass.test.ts.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const RUNNER = fileURLToPath(new URL('../../../../benchmarks/hub-soak.mjs', import.meta.url));

export type Metrics = { openFiles: number; rssBytes: number; children: number };
export type Report = { baseline: Metrics; last: Metrics; verdict: 'PASS' | 'FAIL'; reasons: string[] };

/** Runs `benchmarks/hub-soak.mjs` once with 30 sessions; its exit code, its report line and all it printed. */
export function soak(durationMs: number, sampleMs: number, plant?: string): Promise<{ code: number | null; report?: Report; out: string; root: string }> {
  const root = realpathSync(mkdtempSync('/tmp/soak-41-'));
  const { DEEP_HUB_PLANT: _, ...env } = process.env;
  const child = spawn(process.execPath, [RUNNER, '--sessions', '30', '--duration', String(durationMs), '--sample', String(sampleMs), '--root', root], {
    env: plant ? { ...env, DEEP_HUB_PLANT: plant } : env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.setEncoding('utf8').on('data', (d: string) => { out += d; });
  child.stderr.setEncoding('utf8').on('data', (d: string) => { out += d; });
  return new Promise((resolve) => child.on('close', (code) => {
    let report: Report | undefined;
    for (const line of out.split('\n')) {
      if (!line.trim().startsWith('{')) continue;
      try { const v = JSON.parse(line) as Report; if (v && typeof v === 'object' && 'verdict' in v) report = v; } catch { /* not the report */ }
    }
    resolve({ code, report, out, root });
  }));
}

/** From the record the soak's hub kept under `--root`: sessions ended, and the most open at once. */
export function sessionsOf(root: string): { ended: number; mostOpen: number } {
  const ledger = join(root, '.deepbuild', 'ledger.db');
  if (!existsSync(ledger)) return { ended: 0, mostOpen: 0 };
  const db = new DatabaseSync(ledger, { readOnly: true });
  try {
    const rows = db.prepare("SELECT kind, session_id FROM events WHERE kind IN ('session.start', 'session.end') AND session_id IS NOT NULL ORDER BY log_pos").all() as { kind: string; session_id: string }[];
    const open = new Set<string>();
    let mostOpen = 0;
    let ended = 0;
    for (const r of rows) {
      if (r.kind === 'session.start') open.add(r.session_id);
      else if (open.delete(r.session_id)) ended++;
      mostOpen = Math.max(mostOpen, open.size);
    }
    return { ended, mostOpen };
  } finally {
    db.close();
  }
}

export const isMetrics = (m: unknown): m is Metrics => {
  const v = m as Metrics;
  return !!v && Number.isSafeInteger(v.openFiles) && v.openFiles > 0 && Number.isSafeInteger(v.rssBytes) && v.rssBytes > 0 && Number.isSafeInteger(v.children) && v.children >= 0;
};
