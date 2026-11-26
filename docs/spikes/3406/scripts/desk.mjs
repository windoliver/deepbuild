#!/usr/bin/env node
// Throwaway #3406 spike, the desktop app: nothing here starts a session. `setup` makes a scratch folder whose own
// .claude/settings.json runs hooks/hook.mjs, for a session you open there by hand; `collect` copies what it left.
//   node desk.mjs setup <scenario> --raw <folder> --label <name> [--inbound hold|refuse]
//   node desk.mjs collect --raw <folder> --label <name>
import { randomBytes, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scenarios, settingsFor } from './scenarios.mjs';

const flag = (name) => { const at = process.argv.indexOf(`--${name}`); return at === -1 ? undefined : process.argv[at + 1]; };
const verb = process.argv[2], raw = flag('raw'), label = flag('label'), inbound = flag('inbound');
const run = join(raw, `desktop-${label}`), folder = join(raw, 'desk', label);
if (verb === 'setup') {
  const scenario = scenarios[process.argv[3]]({ nonce: () => randomBytes(4).toString('hex'), uuid: randomUUID });
  mkdirSync(run, { recursive: true });
  mkdirSync(join(folder, '.claude'), { recursive: true });
  writeFileSync(join(run, 'plan.json'), JSON.stringify(scenario.plan, null, 1));
  const settings = JSON.stringify(settingsFor({ actors: scenario.actors, inbound, run, place: 'desktop' }), null, 1);
  writeFileSync(join(folder, '.claude', 'settings.json'), settings);
  writeFileSync(join(run, 'settings.json'), settings);
  console.log(folder);
} else if (verb === 'collect') {
  const logged = existsSync(join(run, 'log.jsonl')) ? readFileSync(join(run, 'log.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : [];
  for (const path of new Set(logged.map((line) => line.payload?.transcript_path).filter(Boolean))) if (existsSync(path)) copyFileSync(path, join(run, `transcript.${path.split('/').at(-1)}`));
  console.log(JSON.stringify({ run, lines: logged.length, sessions: new Set(logged.map((line) => line.session)).size }));
}
