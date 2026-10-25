// #316 AC1, AC4, AC7: with the hub stopped, deep-hook's matcher applies the default fail_closed entries to a
// shell call and denies every kill form through wrappers and heredocs, while a call that only mentions a blocked
// command in text is allowed. The entries are data: an empty rules.json lets `pkill -f node` through, so the rule
// is not compiled into deep-hook. Every decision is the real binary's, with no hub at the address.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  bash, buildDeepHook, carriesReasonNextStep, cleanup, decision, hook, installDefaults, makeHome, newSession,
  shown, writeRules, type Ran, type Rules,
} from './helpers.ts';

let BIN: string;
beforeAll(async () => { BIN = await buildDeepHook(); }, 900_000);
afterEach(cleanup, 60_000);

/** Runs a shell PreToolUse with the defaults installed and no hub. */
async function call(command: string, extra = {}): Promise<{ ran: Ran; rules: Rules }> {
  const home = makeHome();
  const rules = installDefaults(home);
  const s = newSession(home);
  const ran = await hook(home, s, 'PreToolUse', bash(s, command, extra), { binary: BIN });
  return { ran, rules };
}
function expectDenied(command: string, { ran, rules }: { ran: Ran; rules: Rules }): void {
  if (decision(ran) !== 'deny') throw Error(`\`${command}\` must be denied with the hub stopped: ${shown(ran)}`);
  if (!carriesReasonNextStep(ran, rules)) throw Error(`\`${command}\`: the denial carries no default entry's reason and next_step verbatim: ${shown(ran)}`);
}
function expectAllowed(command: string, { ran }: { ran: Ran }): void {
  if (decision(ran) !== 'allow') throw Error(`\`${command}\` must be allowed: ${shown(ran)}`);
}

describe('AC1 #316.47a1dec1 with the hub stopped, pkill -f node is still blocked', () => {
  it('AC1 the default entries deny pkill -f node and carry a reason and a next step; a normal command is allowed', async () => {
    expectDenied('pkill -f node', await call('pkill -f node'));
    expectAllowed('echo hi', await call('echo hi'));
  }, 900_000);

  it('AC1 the entries are data, not compiled in: an empty rules.json lets pkill -f node through', async () => {
    const home = makeHome();
    writeRules(home, { v: 1, entries: {} });
    const s = newSession(home);
    const ran = await hook(home, s, 'PreToolUse', bash(s, 'pkill -f node'), { binary: BIN });
    if (decision(ran) !== 'allow') throw Error(`with no entries, pkill -f node must be allowed (the rule is not in deep-hook): ${shown(ran)}`);
  }, 900_000);
});

describe('AC4 #316.85c1dfdf every kill form is blocked: killall, fuser -k, kill-port, lsof/pgrep into xargs or a loop, through wrappers and heredocs', () => {
  const forms = [
    'killall node',
    'fuser -k 8080/tcp',
    'kill-port 3000',
    'lsof -t -i:3000 | xargs kill',
    'pgrep -f node | xargs kill -9',
    'for p in $(pgrep -f node); do kill "$p"; done',
    'env killall node',                       // through a wrapper
    'sudo pkill -f node',                      // through a wrapper
    "bash <<'EOF'\npkill -f node\nEOF",        // through a heredoc that executes
  ];
  it('AC4 each kill form is denied, carrying a reason and a next step', async () => {
    for (const f of forms) expectDenied(f, await call(f));
  }, 900_000);

  it('AC4 listing without a kill is allowed: lsof and pgrep on their own', async () => {
    expectAllowed('lsof -i:3000', await call('lsof -i:3000'));
    expectAllowed('pgrep -f node', await call('pgrep -f node'));
  }, 900_000);
});

describe('AC7 #316.aa88a9ae text that only mentions a blocked command is allowed', () => {
  const allowed = [
    "rg 'pkill' src/",                                  // a search for the word
    "git commit -m 'remove the pkill call'",            // a commit message
    "cat > notes.txt <<'EOF'\npkill -f node\nkillall x\nEOF", // a heredoc written to a file, not executed
  ];
  it('AC7 a search, a commit message and a heredoc written to a file are each allowed', async () => {
    for (const command of allowed) expectAllowed(command, await call(command));
  }, 900_000);

  it('AC7 the same words that do run are still denied (the twin of the allowed set)', async () => {
    // Writing `pkill` as text is allowed above; running it is denied, so the allow isn't the matcher giving up.
    expect(decision((await call('pkill -f node')).ran)).toBe('deny');
  }, 900_000);
});
