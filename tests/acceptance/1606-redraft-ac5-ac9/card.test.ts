// #1606 AC5 and AC9, redrafted to run with no window (README): the real app's question card answered as the replica
// drives it, by app/card.rs, a test target of deep-app run with HOME the test's home, against a real hub of #1606's
// suite (../1606/helpers.ts). The app's device key is kept by the app's own code, built with its two stand-ins
// (`test-confirm`, `test-secrets`); AC9's move is the real app's, started on the home as AC6 starts it. No permission
// is needed. AC5's wrong program is the app planted to keep its key in a file (`plant-key-in-file`).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { childEnv, REPO, run } from '../16/helpers.ts';
import {
  AC, appEnv, appRuns, appWith, BASE, cleanup, connect, eventsOf, hubWorld, keyHolders, launchApp, olderAppKey, pairedDevices,
  setupFinished, sleep, within, type AppFeature, type Seeded, type World,
} from '../1606/helpers.ts';

afterEach(cleanup, 60_000);

const QUESTION = 'Which name for the settings page title?';
const CARGO_ENV = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };

/** Whether this checkout's app code is the merge base's own, which keeps its key in a file and reaches no Keychain. */
const baseCode = (): boolean => spawnSync('git', ['-C', REPO, 'diff', '--quiet', BASE, '--', 'crates/deep-app/src'], { stdio: 'ignore' }).status === 0;
const built = new Map<string, Promise<string>>();
/** deep-app's `acceptance_1606` test target built with `features`, its executable's path; a missing entry or feature is named. */
function target(features: AppFeature[]): Promise<string> {
  const key = features.join(',');
  let build = built.get(key);
  if (!build) {
    build = (async () => {
      const r = await run('cargo', ['test', '--locked', '-q', '-p', 'deep-app', '--test', 'acceptance_1606', '--features', key, '--no-run', '--message-format=json'], { env: CARGO_ENV, timeoutMs: 1_800_000 });
      const exe = r.stdout.split('\n').map((l) => { try { return JSON.parse(l) as { reason?: string; target?: { name?: string }; executable?: string | null }; } catch { return {}; } })
        .find((m) => m.reason === 'compiler-artifact' && m.target?.name === 'acceptance_1606' && m.executable)?.executable;
      if (r.code === 0 && exe) return exe;
      const missing = /does not contain (?:this|these) features?:? *([\w-]+)/.exec(r.stderr)?.[1];
      if (missing) throw Error(`crates/deep-app/Cargo.toml has no feature ${missing} (../1606/README.md, Surfaces)`);
      if (/no test target named/.test(r.stderr)) throw Error('crates/deep-app/Cargo.toml has no [[test]] acceptance_1606 for app/card.rs (README, Surface)');
      throw Error(`cargo test --no-run of acceptance_1606 exited ${r.code}: ${r.stderr.slice(-1500)}`);
    })();
    built.set(key, build);
  }
  return build;
}
/**
 * The card's driver with both stand-ins and `plants`. Where the crate has no `test-secrets` and its code is the merge
 * base's own, the base's `test-confirm` build, saying what was missing; otherwise BLOCKED, so no run reaches your Keychain.
 */
async function driver(...plants: AppFeature[]): Promise<{ exe: string; missing?: string }> {
  try {
    return { exe: await target(['test-confirm', 'test-secrets', ...plants]) };
  } catch (error) {
    const why = (error as Error).message;
    if (!plants.length && /no feature test-secrets/.test(why) && baseCode()) return { exe: await target(['test-confirm']), missing: why };
    throw Error(`BLOCKED: ${why}`);
  }
}

/** An answer on the card for `ask`, `option` pressed, the OS stand-in saying yes; what's wrong with it, by the record. */
async function answerOnCard(w: World, exe: string, ask: Seeded, option: string): Promise<string[]> {
  const r = await run(exe, [ask.handle, option], { env: childEnv(w.home, appEnv(w, 'confirmed')), cwd: dirname(w.home), timeoutMs: 300_000 });
  const said = r.stdout.trim().split('\n').at(-1) ?? '';
  const out: string[] = [];
  if (r.code !== 0) out.push(`the card's answer to ${ask.handle} wasn't sent: exit ${r.code}, ${said} ${r.stderr.slice(-800)}`);
  const answers = (await eventsOf(await connect(w))).filter((e) => e.kind === 'ask.answered' && e.subject === ask.handle);
  if (answers.length !== 1) out.push(`the record shows ${answers.length} answers to ${ask.handle}, not one`);
  for (const a of answers) {
    if (a.data?.answer !== option) out.push(`the record shows ${ask.handle} answered ${String(a.data?.answer)}, not ${option}`);
    if (a.data?.via !== 'card') out.push(`${ask.handle}'s answer came ${String(a.data?.via)}, not from the card`);
  }
  return out;
}
/** A choice ask seeded before the hub starts, and the option the card presses: not the first, so it is no default. */
async function world(): Promise<{ w: World; ask: Seeded; option: string }> {
  const w = await hubWorld({ asks: [{ source: 'deep_ask.choice', question: QUESTION }], files: setupFinished });
  const ask = w.asks[0]!;
  const option = ask.options.at(-1)?.id;
  if (!option) throw Error(`BLOCKED: setup: ${ask.handle} has no options`);
  return { w, ask, option };
}

/** The app pairs and answers once on its card; then the files under ~/.deepbuild holding a paired device's private key. */
async function pairedAndAnswered(...plants: AppFeature[]): Promise<{ root: string; answered: string[]; holders: string[]; missing?: string | undefined }> {
  const { exe, missing } = await driver(...plants);
  const { w, ask, option } = await world();
  const answered = await answerOnCard(w, exe, ask, option);
  const devices = pairedDevices(w.root);
  if (!devices.size) answered.push('the app paired no device with the hub, so no answer of its could have counted');
  return { root: w.root, answered, holders: keyHolders(w.root, devices), missing };
}

describe(`${AC[5]} After the app has paired and answered once, no file under ~/.deepbuild holds the device's private key`, () => {
  it(`${AC[5]} after the app paired and its card's answer counted once, no file under ~/.deepbuild holds the device's private key (no window)`, async () => {
    const got = await pairedAndAnswered();
    expect([...got.answered, ...got.holders]).toEqual([]);
    expect(got.missing, 'the app was built with its stand-ins (../1606/README.md, Surfaces)').toBeUndefined();
  }, 1_800_000);

  it(`${AC[5]} wrong program: an app that keeps its key in a file (plant-key-in-file) fails, naming the path (no window)`, async () => {
    const got = await pairedAndAnswered('plant-key-in-file');
    expect(got.answered, 'the planted app still pairs and answers').toEqual([]);
    expect(got.holders.join('\n')).toContain(`${join(got.root, 'app', 'device.json')} holds the private key of`);
  }, 1_800_000);
});

describe(`${AC[9]} After the move, an answer on the card in the real app still counts once`, () => {
  it(`${AC[9]} after the real app moves an older app's key out of ~/.deepbuild/app/device.json at its start, an answer on its card counts once, signed with that key (no window)`, async () => {
    const [{ exe, missing }, app] = await Promise.all([driver(), appWith()]);
    const { w, ask, option } = await world();
    const older = await olderAppKey(w);
    const before = [...pairedDevices(w.root).values()];
    const started = launchApp(w.home, app.binary, appEnv(w, 'confirmed'));
    await appRuns(w.home, started, `deepbuild://ask/${ask.handle.slice('ask:'.length)}`);
    const moved = await within(120_000, () => !existsSync(older.file));
    // The app that moved the key leaves before the card answers, so the one answer is the card's.
    started.child.kill('SIGTERM');
    for (let i = 0; i < 50 && started.child.exitCode === null && started.child.signalCode === null; i++) await sleep(100);
    const failures: string[] = [];
    if (!moved) failures.push(`${older.file} is still there two minutes after the app started: the app didn't move the key`);
    else {
      failures.push(...(await answerOnCard(w, exe, ask, option)));
      const paired = [...pairedDevices(w.root).values()].filter((d) => !before.includes(d));
      if (paired.length) failures.push(`the app paired ${paired.join(', ')} after the move, so its answer wasn't signed with the key it moved (${older.device.id})`);
    }
    expect(failures).toEqual([]);
    expect(missing ?? app.missing, 'the app was built with its stand-ins (../1606/README.md, Surfaces)').toBeUndefined();
  }, 1_800_000);
});
