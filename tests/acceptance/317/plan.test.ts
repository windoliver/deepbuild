// #317 AC2, AC3: with the hub stopped, what the plan doesn't name. A command that creates a cloud resource is
// denied with the reason, since nobody can be asked and no standing rule in rules.json covers it; a dependency is
// allowed and recorded (spooled, then in the record once the hub replays it); an agent's write to rules.json is
// denied; and an agent-written script that deletes an untracked folder, whose reach can't be worked out, is denied
// and the folder keeps its files. Only AC3's script is ever run, in its own temp repo, and only once allowed.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  bash, buildDeepHook, carriesReasonNextStep, childEnv, cleanup, decide, decision, defaultRules, expectAllowed,
  expectDenied, hook, makeRepo, recorded, rootOf, run, sh, shown, startHub, without, world, write, type Call, type Rules,
  type World,
} from './helpers.ts';

beforeAll(async () => { await buildDeepHook(); }, 900_000);
afterEach(cleanup, 60_000);

// An AWS account the plan doesn't name: a profile no standing rule in rules.json names.
const KMS = "aws kms create-key --profile shop-new-account --description 'orders key'";

describe('AC2 #317.5ca7ac42 hub stopped: a KMS key in an unnamed AWS account is denied with the reason, npm install of an unnamed package is allowed and recorded, and a write to rules.json is denied', () => {
  it('AC2 creating a KMS key the plan does not name is denied carrying the reason; listing keys is allowed', async () => {
    const w = await world({ rules: defaultRules(), mode: 'stopped' });
    await expectDenied(w, [sh(KMS)]);
    await expectAllowed(w, [sh('aws kms list-keys --profile shop-new-account')]);
  }, 900_000);

  it('AC2 npm install of a package the plan does not name is allowed, and is recorded once the hub replays the spool', async () => {
    const w = await world({ rules: defaultRules(), mode: 'stopped' });
    const npm = 'npm install left-pad@1.3.0';
    const ran = await hook(w.home, w.s, bash(w.s, npm));
    if (decision(ran) !== 'allow') throw Error(`npm install of an unnamed package must be allowed with the hub stopped: ${shown(ran)}`);
    // Recorded: the hub, started afterwards, replays the spool, and its record holds the call in this session.
    const hub = await startHub(w.home);
    if (!(await recorded(hub.root, [w.s.id, npm]))) throw Error(`the allowed \`${npm}\` of session ${w.s.id} never reached the record after the hub started and replayed the spool; the hook said: ${shown(ran)}`);
  }, 900_000);

  it("AC2 an agent's Write of ~/.deepbuild/rules.json is denied carrying the reason", async () => {
    const w = await world({ rules: defaultRules(), mode: 'stopped' });
    await expectDenied(w, [{ label: 'Write ~/.deepbuild/rules.json', body: (x) => write(x.s, join(rootOf(x.home), 'rules.json'), '{"v":1,"entries":{}}') }]);
  }, 900_000);
});

// The agent's script: it deletes the untracked build-cache/ next to it, from wherever it is started.
const CLEAN = '#!/bin/sh\ncd "$(dirname "$0")/.." || exit 1\nrm -rf build-cache\n';
interface Shop { repo: string; cache: string }
function shop(): Shop {
  const repo = makeRepo({ README: 'shop\n', 'src/cart.ts': 'export const total = 0;\n', '.gitignore': '' }).dir;
  const cache = join(repo, 'build-cache');
  mkdirSync(join(cache, 'objs'), { recursive: true });
  for (const f of ['a.o', 'b.o', 'objs/c.o']) writeFileSync(join(cache, f), 'bytes\n');
  return { repo, cache };
}
const cacheFiles = (cache: string) => (existsSync(cache) ? readdirSync(cache, { recursive: true }).length : 0);
const runs: Call[] = [sh('./scripts/clean.sh'), sh('sh scripts/clean.sh')];

/**
 * The agent writes scripts/clean.sh (its Write is decided first, as in a session), then runs it. A call deep-hook
 * allows is run as the agent's Bash would, in the temp repo only. Throws when a run is allowed or the folder loses
 * a file, naming the call.
 */
async function judge(rules: Rules, s: Shop): Promise<World> {
  const w = await world({ rules, mode: 'stopped', cwd: s.repo });
  const wrote = await hook(w.home, w.s, write(w.s, join(s.repo, 'scripts/clean.sh'), CLEAN));
  if (decision(wrote) !== 'allow') throw Error(`the agent's Write of scripts/clean.sh must be allowed: ${shown(wrote)}`);
  mkdirSync(join(s.repo, 'scripts'), { recursive: true });
  writeFileSync(join(s.repo, 'scripts/clean.sh'), CLEAN);
  chmodSync(join(s.repo, 'scripts/clean.sh'), 0o755);
  const before = cacheFiles(s.cache);
  for (const call of runs) {
    const ran = await decide(w, call);
    if (decision(ran) === 'allow') {
      await run('/bin/sh', ['-c', call.label], { cwd: s.repo, env: childEnv(w.home) });
      throw Error(`\`${call.label}\` was allowed with the hub stopped; it ran and build-cache/ went from ${before} to ${cacheFiles(s.cache)} files`);
    }
    if (decision(ran) !== 'deny') throw Error(`\`${call.label}\` must be denied: ${shown(ran)}`);
    if (!carriesReasonNextStep(ran, rules)) throw Error(`\`${call.label}\`: the denial doesn't say why (no shipped entry's reason and next_step): ${shown(ran)}`);
  }
  if (cacheFiles(s.cache) !== before) throw Error(`build-cache/ lost files: ${before} before, ${cacheFiles(s.cache)} after`);
  return w;
}

describe('AC3 #317.451c838d hub stopped: an agent-written scripts/clean.sh that deletes the untracked build-cache/ is denied, naming why, and build-cache/ keeps its files; a fails-open deep-hook fails', () => {
  it('AC3 running the script is denied, carrying the reason, and build-cache/ keeps every file; reading the script and listing the folder are allowed', async () => {
    const s = shop();
    const w = await judge(defaultRules(), s);
    expect(cacheFiles(s.cache)).toBe(4);
    await expectAllowed(w, [sh('cat scripts/clean.sh'), sh('ls build-cache')]);
  }, 900_000);

  it('AC3 (wrong program) a deep-hook that fails open on the script runs it, empties build-cache/ and fails', async () => {
    const s = shop();
    const prep = (home: string) => {
      void home;
      mkdirSync(join(s.repo, 'scripts'), { recursive: true });
      writeFileSync(join(s.repo, 'scripts/clean.sh'), CLEAN);
      chmodSync(join(s.repo, 'scripts/clean.sh'), 0o755);
    };
    const plant = await without(defaultRules(), runs[0]!, s.repo, prep);
    await expect(judge(plant.rules, s)).rejects.toThrow(/`\.\/scripts\/clean\.sh` was allowed .* build-cache\/ went from 4 to 0 files/);
    expect(existsSync(s.cache) ? cacheFiles(s.cache) : 0).toBe(0);
  }, 900_000);
});
