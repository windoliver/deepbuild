// AC5: `deep setup` and the app's Set up say the same sentence from one definition. The CLI's line is what a real
// `deep setup` prints in #19's stand-in home; the app's is what `deep-app --set-up` prints, the first launch's Set up
// click run with no window (#326), in another such home. "One definition": the shipped source (packages/, crates/ and
// contracts/, tests and build output aside) holds the line once (helpers.ts, definitionFailures).
import { afterAll, describe, expect, it } from 'vitest';
import * as t19 from '../19/doctor/helpers.ts';
import { AC5, appBinary, cleanup, deepHook, definitionFailures, MINUTES, shippedFiles } from './helpers.ts';

const LONG = 30 * MINUTES;
afterAll(async () => { await cleanup(); await t19.cleanup(); }, 60_000);

/** A stand-in home with a hub answering, as #19's world has it before `deep setup`. */
async function home(): Promise<{ h: t19.Home; hub: t19.Hub }> {
  const h = t19.makeHome();
  t19.writeSettings(h, { env: { ...t19.TELEMETRY } });
  await deepHook();
  const hub = await t19.startHub(h);
  return { h, hub };
}
const theLine = (out: string, who: string): string => {
  const lines = out.split('\n').map((l) => l.trim()).filter((l) => l.includes('deep setup --undo'));
  if (lines.length !== 1) expect.fail(`${who} must say one line naming deep setup --undo; it said ${JSON.stringify(out.slice(-1500))}`);
  return lines[0]!;
};
/** Each line's definitions, the CLI's and the app's (one, when they are the same line). */
const definitions = (cli: string, app: string, files: ReadonlyMap<string, string>): string[] => [...new Set([cli, app])].flatMap((line) => definitionFailures(line, files));
let said: { cli: string; app: string } | undefined;
async function lines(): Promise<{ cli: string; app: string }> {
  if (said) return said;
  const a = await home();
  const set = await t19.deep(a.h, ['setup']);
  expect(set.code, `deep setup must exit 0 in the stand-in home: ${t19.shown(set)}`).toBe(0);
  const cli = theLine(set.stderr + set.stdout, 'deep setup');
  const b = await home();
  const ran = await t19.run(await appBinary(), ['--set-up'], { env: t19.childEnv(b.h), cwd: b.h.work, timeoutMs: 300_000 });
  expect(ran.code, `deep-app --set-up must exit 0 in the stand-in home: ${t19.shown(ran)}`).toBe(0);
  said = { cli, app: theLine(ran.stdout + ran.stderr, 'the app\'s Set up') };
  return said;
}

describe('#1455 the line Set up says', () => {
  it(`${AC5}: deep setup and the app's Set up say the same sentence from one definition`, async () => {
    const { cli, app } = await lines();
    const failures = [
      ...(app === cli ? [] : [`the app's Set up says ${JSON.stringify(app)}, and deep setup ${JSON.stringify(cli)}`]),
      ...['watch-only mode', 'deep setup --undo'].filter((words) => !cli.includes(words)).map((words) => `deep setup's line lacks "${words}"`),
      ...definitions(cli, app, shippedFiles()),
    ];
    expect(failures).toEqual([]);
  }, LONG);

  it(`${AC5}: a planted second copy fails, naming the file`, async () => {
    const { cli, app } = await lines();
    const files = shippedFiles();
    expect(definitions(cli, app, files), 'the clean tree already fails AC5, so the plant can\'t be told from it').toEqual([]);
    const planted = 'crates/deep-app/src/set_up_copy.rs';
    files.set(planted, `pub const SET_UP_LINE: &str = ${JSON.stringify(cli)};\n`);
    const failures = definitionFailures(cli, files);
    expect(failures.filter((f) => f.includes(planted)), `the planted second copy wasn't caught naming ${planted}: ${JSON.stringify(failures)}`).not.toEqual([]);
  }, LONG);
});
