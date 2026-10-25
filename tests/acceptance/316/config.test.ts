// #316 AC3: an agent's Edit, Write or `sed -i` of another agent's config (~/.codex/config.toml,
// ~/.claude/settings.json) or a skills folder is denied with the hub stopped, and the denial names deep_propose,
// the way to propose a change to an agent's config. A write to an ordinary file is allowed. Hub stopped.
import { afterEach, beforeAll, describe, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  bash, buildDeepHook, carriesReasonNextStep, cleanup, decision, denialText, edit, hook, installDefaults,
  makeHome, newSession, shown, write, type Line, type Ran, type Rules,
} from './helpers.ts';

let BIN: string;
beforeAll(async () => { BIN = await buildDeepHook(); }, 900_000);
afterEach(cleanup, 60_000);

/** Creates a home with the defaults installed and the config files present, and returns the paths. */
function world(): { home: string; rules: Rules; session: ReturnType<typeof newSession>; codex: string; claude: string; skill: string; ordinary: string } {
  const home = makeHome();
  const rules = installDefaults(home);
  const session = newSession(home);
  const codex = join(home, '.codex', 'config.toml');
  const claude = join(home, '.claude', 'settings.json');
  const skill = join(home, '.claude', 'skills', 'mine', 'SKILL.md');
  const ordinary = join(session.cwd, 'notes.md');
  for (const f of [codex, claude, skill, ordinary]) { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, ''); }
  return { home, rules, session, codex, claude, skill, ordinary };
}
async function run(w: ReturnType<typeof world>, body: Line): Promise<Ran> {
  return hook(w.home, w.session, 'PreToolUse', body, { binary: BIN });
}
function expectDeniedNamingPropose(label: string, w: ReturnType<typeof world>, ran: Ran): void {
  if (decision(ran) !== 'deny') throw Error(`${label} must be denied with the hub stopped: ${shown(ran)}`);
  if (!carriesReasonNextStep(ran, w.rules)) throw Error(`${label}: the denial carries no default entry's reason and next_step: ${shown(ran)}`);
  if (!denialText(ran).includes('deep_propose')) throw Error(`${label}: the denial does not name deep_propose: ${shown(ran)}`);
}

describe("AC3 #316.26d87d62 an agent's Edit, Write or sed -i of another agent's config or a skills folder is denied with the hub stopped, naming deep_propose", () => {
  it('AC3 Edit of a settings file, Write of a config file, sed -i of a config, and Edit of a skill are each denied naming deep_propose', async () => {
    const w = world();
    expectDeniedNamingPropose('Edit of ~/.claude/settings.json', w, await run(w, edit(w.session, w.claude)));
    expectDeniedNamingPropose('Write of ~/.codex/config.toml', w, await run(w, write(w.session, w.codex)));
    expectDeniedNamingPropose('sed -i of ~/.codex/config.toml', w, await run(w, bash(w.session, `sed -i s/a/b/ ${w.codex}`)));
    expectDeniedNamingPropose('Edit of a skills folder file', w, await run(w, edit(w.session, w.skill)));
  }, 900_000);

  it('AC3 an ordinary file write is allowed (the twin, so the rule is not denying every write)', async () => {
    const w = world();
    if (decision(await run(w, edit(w.session, w.ordinary))) !== 'allow') throw Error('Edit of an ordinary file must be allowed');
    if (decision(await run(w, write(w.session, join(w.session.cwd, 'out.txt')))) !== 'allow') throw Error('Write of an ordinary file must be allowed');
  }, 900_000);
});
