// `deep gate rules` (#1325): the rulesets the repo's forge needs so that only the gate turns a commit green, by the
// apps your settings name. It prints them and changes nothing on the forge (#46): you put them on as the repo's admin.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rulesets } from '@deepbuild/github';
import { activePlant } from './plant.js';
import { installedRoot } from './paths.js';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const USAGE = 'Usage: deep gate rules [--json]   the rulesets your repo needs, as GitHub\'s create-a-repository-ruleset call takes them';

export function gateCommand(args: readonly string[]): number {
  if (args[0] !== 'rules' || args.slice(1).some((a) => a !== '--json')) { process.stderr.write(`${USAGE}\n`); return 2; }
  let github: unknown;
  try { github = (JSON.parse(readFileSync(join(installedRoot(), 'config.json'), 'utf8')) as { github?: unknown }).github; } catch { /* none yet */ }
  const idOf = (which: string): number | null => {
    const app = isObj(github) ? github[which] : undefined;
    return isObj(app) && Number.isSafeInteger(app.app_id) ? app.app_id as number : null;
  };
  const gate = idOf('gate');
  if (gate === null) { process.stderr.write('deep gate rules: name the gate\'s GitHub App in your settings first, as github.gate: { "app_id": <id>, "key": "<Keychain service>" }\n'); return 1; }
  const plant = activePlant();
  const out = { rulesets: rulesets({ gate, agents: idOf('agents'), ...(plant ? { plant } : {}) }) };
  process.stdout.write(args.includes('--json') ? `${JSON.stringify(out)}\n` : `${JSON.stringify(out, null, 2)}\nPut each on as the repo's admin; the README's Verdicts on GitHub says how.\n`);
  return 0;
}
