// #1503 AC4: the twins run. `python3 -c "print(1)"`, `node -e "console.log(1)"`, `echo hello | base64`,
// `cat scripts/build.sh | sh` (a file this test writes in a temp checkout, holding nothing a block entry matches) and
// `curl -s https://example.com/x.json | python3 -c "import json,sys; print(json.load(sys.stdin))"` are allowed with the
// hub up and with it stopped by its PID. A reader that reads any pipe into an interpreter as unread (the planted
// `plant-any-pipe-unread` build) denies the last and fails this test, naming it. The Scope's "a shell reading a pipe
// whose source is a plain file on disk is read as that file" is held beside it: the same `cat scripts/build.sh | sh`,
// with a file that writes ~/.deepbuild/rules.json, is denied with the hub stopped, so the twin is allowed because the
// file was read, not because every file pipe is. No call is ever executed: each is a PreToolUse payload.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  AC4, bashCall, buildDeepHook, cleanup, decision, failureOf, hook, must, newSession, preToolUse, shown,
  stoppedHome, tempDir, told, type Ran,
} from './helpers.ts';

let BIN: string;
beforeAll(async () => { BIN = await buildDeepHook(); }, 900_000);
afterEach(cleanup, 60_000);

const PLANT = 'plant-any-pipe-unread';
const BUILD = 'cat scripts/build.sh | sh';
const CURL_PY = 'curl -s https://example.com/x.json | python3 -c "import json,sys; print(json.load(sys.stdin))"';
/** A build script with nothing a block entry matches. */
const CLEAN_SCRIPT = '#!/bin/sh\nset -e\necho building\nmkdir -p dist\ncp src/*.txt dist/\necho done\n';
/** The same script name holding a write a shipped fail_closed entry (no-deepbuild-home-write) blocks. */
const BLOCKED_SCRIPT = "#!/bin/sh\nset -e\nsed -i 's/\"block\"/\"watch\"/' ~/.deepbuild/rules.json\n";

/** A temp checkout holding scripts/build.sh with `script` in it. */
function checkout(script: string): string {
  const dir = join(tempDir(), 'repo');
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'scripts', 'build.sh'), script, { mode: 0o755 });
  writeFileSync(join(dir, 'src', 'a.txt'), 'a\n');
  return dir;
}

const twins = (repo: string) => [
  bashCall('python3 -c "print(1)"'),
  bashCall('node -e "console.log(1)"'),
  bashCall('echo hello | base64'),
  bashCall(BUILD, repo),
  bashCall(CURL_PY),
];
const PHASES = ['up', 'stopped'] as const;
type Phase = (typeof PHASES)[number];
interface Seen { lines: string[]; runs: Partial<Record<Phase, Ran[]>> }

async function observe(binary: string, phases: readonly Phase[]): Promise<Seen> {
  const repo = checkout(CLEAN_SCRIPT);
  const list = twins(repo);
  let s: ReturnType<typeof newSession> | undefined;
  const pass = async (home: string) => {
    s ??= newSession(home);
    const out: Ran[] = [];
    for (const c of list) out.push(await hook(home, preToolUse(s, c), binary));
    return out;
  };
  const { home, up } = await stoppedHome(phases.includes('up') ? pass : undefined);
  const runs: Seen['runs'] = {};
  if (up) runs.up = up;
  if (phases.includes('stopped')) runs.stopped = await pass(home);
  return { lines: list.map((c) => String(c.tool_input.command)), runs };
}

/** Every twin not allowed, in one message, so a wrong program's failure names each call it denies. */
function judgeAC4(o: Seen): void {
  const wrong: string[] = [];
  for (const [phase, runs] of Object.entries(o.runs)) {
    o.lines.forEach((line, i) => {
      const got = runs![i]!;
      if (decision(got) !== 'allow') wrong.push(`the twin \`${line}\` must run, allowed, with the hub ${phase}: ${shown(got)}`);
    });
  }
  must(!wrong.length, wrong.join('\n'));
}

describe(`AC4 ${AC4} the twins run; a rule that reads any pipe into an interpreter denies the last and fails`, () => {
  it(`AC4 python3 -c "print(1)", node -e "console.log(1)", echo hello | base64, ${BUILD} (a clean file) and ${CURL_PY} are each allowed, hub up and stopped`, async () => {
    judgeAC4(await observe(BIN, PHASES));
  }, 900_000);

  it(`AC4 (Scope: a pipe from a plain file is read as that file) ${BUILD}, the file writing ~/.deepbuild/rules.json, is denied with the hub stopped, naming no-deepbuild-home-write`, async () => {
    const repo = checkout(BLOCKED_SCRIPT);
    const { home } = await stoppedHome();
    const got = await hook(home, preToolUse(newSession(home), bashCall(BUILD, repo)), BIN);
    must(decision(got) === 'deny', `\`${BUILD}\` with scripts/build.sh writing ~/.deepbuild/rules.json must be denied with the hub stopped: ${shown(got)}`);
    must(told(got).includes('no-deepbuild-home-write'), `\`${BUILD}\`: the denial must name no-deepbuild-home-write: ${shown(got)}`);
  }, 900_000);

  it(`AC4 (wrong program) a reader that reads any pipe into an interpreter as unread (${PLANT}) denies the last twin and fails this test, naming it`, async () => {
    const seen = await observe(await buildDeepHook({ features: [PLANT] }), ['stopped']);
    const failure = await failureOf(() => judgeAC4(seen));
    expect(failure, `${PLANT} must fail the criterion`).not.toBeNull();
    expect(failure, 'the failure names the last twin').toContain(CURL_PY);
    const last = seen.runs.stopped![seen.lines.length - 1]!;
    expect(decision(last), `${PLANT} denies \`${CURL_PY}\` with the hub stopped: ${shown(last)}`).toBe('deny');
  }, 900_000);
});
