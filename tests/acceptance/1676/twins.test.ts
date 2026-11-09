// #1676 AC2: the twins run. `env -S "echo hi"`, `curl -o x.json https://example.com/x.json && cat x.json`,
// `sh scripts/build.sh` (a file this test writes in a temp checkout, holding nothing a block entry matches),
// `deno run main.ts` (a clean file beside it), `uv run python -c "print(1)"`, `uv run pytest` and `php -nr "echo 1;"`
// are allowed with the hub up and with it stopped by its PID. A reader that counts every command after an earlier one
// on the line as unread (the planted `plant-later-command-unread`) denies the curl twin and fails this test, naming
// it. Beside them, the design's "a shell reading a plain file on disk is read as that file": the same
// `sh scripts/build.sh`, with a file that writes ~/.deepbuild/rules.json, is denied with the hub stopped, so the twin
// is allowed because the file was read. No call is ever executed: each is a PreToolUse payload.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  AC2, bashCall, buildDeepHook, cleanup, decision, failureOf, hook, must, newSession, preToolUse, shown,
  stoppedHome, tempDir, told, type Ran,
} from './helpers.ts';

let BIN: string;
beforeAll(async () => { BIN = await buildDeepHook(); }, 900_000);
afterEach(cleanup, 60_000);

const PLANT = 'plant-later-command-unread';
const BUILD = 'sh scripts/build.sh';
const CURL_CAT = 'curl -o x.json https://example.com/x.json && cat x.json';
const TWINS = ['env -S "echo hi"', CURL_CAT, BUILD, 'deno run main.ts', 'uv run python -c "print(1)"', 'uv run pytest', 'php -nr "echo 1;"'];
/** A build script with nothing a block entry matches. */
const CLEAN_SCRIPT = '#!/bin/sh\nset -e\necho building\nmkdir -p dist\ncp src/*.txt dist/\necho done\n';
/** The same script name holding a write a shipped fail_closed entry (no-deepbuild-home-write) blocks. */
const BLOCKED_SCRIPT = "#!/bin/sh\nset -e\nsed -i 's/\"block\"/\"watch\"/' ~/.deepbuild/rules.json\n";

/** A temp checkout holding scripts/build.sh with `script` in it, and a clean main.ts. */
function checkout(script: string): string {
  const dir = join(tempDir(), 'repo');
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'scripts', 'build.sh'), script, { mode: 0o755 });
  writeFileSync(join(dir, 'src', 'a.txt'), 'a\n');
  writeFileSync(join(dir, 'main.ts'), 'console.log("hi");\n');
  return dir;
}

const PHASES = ['up', 'stopped'] as const;
type Phase = (typeof PHASES)[number];
type Seen = Partial<Record<Phase, Ran[]>>;

/** Every twin through `binary`, run in the temp checkout, in each phase asked for. */
async function observe(binary: string, phases: readonly Phase[]): Promise<Seen> {
  const repo = checkout(CLEAN_SCRIPT);
  let s: ReturnType<typeof newSession> | undefined;
  const pass = async (home: string) => {
    s ??= newSession(home);
    const out: Ran[] = [];
    for (const line of TWINS) out.push(await hook(home, preToolUse(s, bashCall(line, repo)), binary));
    return out;
  };
  const { home, up } = await stoppedHome(phases.includes('up') ? pass : undefined);
  const seen: Seen = {};
  if (up) seen.up = up;
  if (phases.includes('stopped')) seen.stopped = await pass(home);
  return seen;
}

/** Every twin not allowed, in one message, so a wrong program's failure names each call it denies. */
function judgeAC2(seen: Seen): void {
  const wrong: string[] = [];
  for (const [phase, runs] of Object.entries(seen)) {
    TWINS.forEach((line, i) => {
      const got = runs![i]!;
      if (decision(got) !== 'allow') wrong.push(`the twin \`${line}\` must run, allowed, with the hub ${phase}: ${shown(got)}`);
    });
  }
  must(!wrong.length, wrong.join('\n'));
}

describe(`AC2 ${AC2} the twins run`, () => {
  it(`AC2 ${TWINS.join(', ')} are each allowed, hub up and stopped`, async () => {
    judgeAC2(await observe(BIN, PHASES));
  }, 900_000);

  it(`AC2 (design: a shell reading a plain file is read as that file) ${BUILD}, the file writing ~/.deepbuild/rules.json, is denied with the hub stopped, naming no-deepbuild-home-write`, async () => {
    const repo = checkout(BLOCKED_SCRIPT);
    const { home } = await stoppedHome();
    const got = await hook(home, preToolUse(newSession(home), bashCall(BUILD, repo)), BIN);
    must(decision(got) === 'deny', `\`${BUILD}\` with scripts/build.sh writing ~/.deepbuild/rules.json must be denied with the hub stopped: ${shown(got)}`);
    must(told(got).includes('no-deepbuild-home-write'), `\`${BUILD}\`: the denial must name no-deepbuild-home-write: ${shown(got)}`);
  }, 900_000);

  it(`AC2 (wrong program) a reader that counts every later command on the line as unread (${PLANT}) denies ${CURL_CAT} and fails this test, naming it`, async () => {
    const seen = await observe(await buildDeepHook({ features: [PLANT] }), ['stopped']);
    const failure = await failureOf(() => judgeAC2(seen));
    expect(failure, `${PLANT} must fail the criterion`).not.toBeNull();
    expect(failure, 'the failure names the curl twin').toContain(CURL_CAT);
    const curl = seen.stopped![TWINS.indexOf(CURL_CAT)]!;
    expect(decision(curl), `${PLANT} denies \`${CURL_CAT}\` with the hub stopped: ${shown(curl)}`).toBe('deny');
  }, 900_000);
});
