// Check for updates (#41): "up to date" only after a check that succeeded. Offline or refused, it says it couldn't
// check and when it last did, and the failure never moves that time.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface UpdateCheck { line: string; status: 'up-to-date' | 'update-available' | 'could-not-check' }

export async function checkForUpdate({ fetchManifest, current, statePath, now }: {
  fetchManifest: () => Promise<{ version: string }>; current: string; statePath: string; now: () => Date;
}): Promise<UpdateCheck> {
  try {
    const manifest = await fetchManifest();
    if (typeof manifest?.version !== 'string') throw new Error('the answer named no version');
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify({ lastCheck: now().toISOString() }));
    return manifest.version === current
      ? { status: 'up-to-date', line: `DeepBuild ${current} is up to date.` }
      : { status: 'update-available', line: `DeepBuild ${manifest.version} is available; this is ${current}.` };
  } catch {
    let last = 'never';
    try { last = (JSON.parse(readFileSync(statePath, 'utf8')) as { lastCheck: string }).lastCheck; } catch { /* no earlier check */ }
    return { status: 'could-not-check', line: `Couldn't check for updates; the last check was ${last === 'never' ? 'never' : `at ${last}`}.` };
  }
}
