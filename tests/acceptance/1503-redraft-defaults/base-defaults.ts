import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE, REPO, makeHome, rootOf, startHub, stopHub } from '../1503/helpers.ts';

export function seedBaseDefaults(home: string): void {
  const text = execFileSync('git', ['-C', REPO, 'show', `${BASE}:crates/deep-hook/default-rules.json`], { encoding: 'utf8' });
  mkdirSync(rootOf(home), { recursive: true, mode: 0o700 });
  writeFileSync(join(rootOf(home), 'rules.json'), text);
}

export async function stoppedBaseHome(): Promise<{ home: string }> {
  const home = makeHome();
  seedBaseDefaults(home);
  const hub = await startHub(home);
  await stopHub(hub);
  return { home };
}
