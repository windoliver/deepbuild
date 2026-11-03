// #1097 AC4: the first-party fail_closed entry no-deep-off (`run:deep off`, a match that names a program), with its
// shipped planted call and twin, taken verbatim from crates/deep-hook/default-rules.json, is installed through
// `deep guard add`. With the hub's install running deep-hook's check mode from a build that misses computed programs
// (cargo feature plant-computed-misses, handed to the hub as DEEP_HUB_TEST_DEEP_HOOK), the computed-program form of its
// planted call is allowed, so the install refuses the entry, naming it, and it doesn't reach rules.json. The control:
// the same install with the hub's own deep-hook goes in. No call here is ever executed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';
import {
  AC4, buildDeepHook, cleanup, defaultsFile, guardAdd, guardFile, makeHome, must, readRules, rootOf, shown, startHub,
  stopHub, type Ran, type Rules,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const NAME = 'no-deep-off';

async function install(env: Record<string, string> = {}): Promise<{ added: Ran; rules: Rules | undefined }> {
  const shipped = defaultsFile();
  const entry = shipped.entries[NAME];
  const proof = shipped.proofs?.[NAME];
  must(entry?.fail_closed === true && entry.match === 'run:deep off' && proof !== undefined, `BLOCKED: default-rules.json must ship ${NAME} (run:deep off, fail_closed) with its planted call and twin: ${JSON.stringify(entry)}`);
  const home = makeHome();
  mkdirSync(rootOf(home), { recursive: true, mode: 0o700 });
  writeFileSync(join(rootOf(home), 'rules.json'), '{"v":1,"entries":{}}\n');
  const hub = await startHub(home, { env });
  try {
    const added = await guardAdd(home, guardFile({ [NAME]: { guard: entry!, planted: proof!.planted, twin: proof!.twin } }));
    return { added, rules: readRules(home) };
  } finally {
    await stopHub(hub);
  }
}
const said = (r: Ran) => `${r.stdout}\n${r.stderr}`;

describe(`AC4 ${AC4} an install whose computed-program form of a fail_closed entry's planted call is allowed refuses the entry`, () => {
  it(`AC4 ${NAME} installs with the hub's own deep-hook, and is refused, naming it, when the install's check mode misses computed programs (plant-computed-misses)`, async () => {
    const sound = await install();
    must(sound.added.code === 0, `${NAME} (the control): with the hub's own deep-hook, which reads a computed program as a possible match, it must install, exit 0: ${shown(sound.added)}`);
    must(sound.rules?.entries[NAME] !== undefined, `${NAME} (the control): an installed entry must reach rules.json: ${JSON.stringify(sound.rules?.entries)}`);

    const missing = await buildDeepHook({ features: ['plant-computed-misses'] });
    const refused = await install({ DEEP_HUB_TEST_DEEP_HOOK: missing });
    must(refused.added.code === 1, `${NAME}: an install whose computed-program form of its planted call is allowed must refuse the entry, exit 1: ${shown(refused.added)}`);
    must(said(refused.added).includes(NAME), `${NAME}: the refusal must name the entry: ${shown(refused.added)}`);
    must(refused.rules?.entries[NAME] === undefined, `${NAME}: a refused entry must not reach rules.json: ${JSON.stringify(refused.rules?.entries[NAME])}`);
  }, 900_000);
});
