// #994 AC5, shown to you, its two window pictures from the real window: the count with the hub not answering and the not
// notified ask row, captured from that one window at the reference window, light, into $DA994_SCREENS (a temp folder
// without it). Whether they look right is one taste call, a person's, in TASTE.json; without it the test fails
// INCONCLUSIVE, never passes. The judges only say the screen is the right state; nothing reads a picture for how it looks.
// The third picture, a notification, isn't a window of the app: it stays with ../taste.test.ts (README).
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { AC5, cleanup, setUpWorld, sleep, stopHub, tempDir } from '../helpers.ts';
import { appBinary, inconclusive, kept, pngSize, REFERENCE, sha256File, tasteCall, type App, type Seen, type Taste } from '../../1002/first-screen-redraft/window.ts';
import { askedRow, hubCountFailures, open, rowFailures } from './helpers.ts';

afterAll(cleanup, 60_000);

const TASTE = fileURLToPath(new URL('./TASTE.json', import.meta.url));
const SHOTS = ['hub-not-answering.png', 'not-notified-row.png'];

async function shot(app: App, judge: (s: Seen) => string[], name: string, out: string): Promise<void> {
  await app.sizeTo(REFERENCE);
  const { seen, failures } = await app.settled(judge);
  await app.stop();
  if (failures.length) expect.fail(`#994 the window to show you isn't the state it should be: ${failures.join('\n')}`);
  const [w, h] = pngSize(seen.picture);
  if (w !== REFERENCE.width * REFERENCE.scale || h !== REFERENCE.height * REFERENCE.scale) inconclusive(`${name} is ${w} × ${h} px, not the reference window's, so this Mac can't take it`);
  copyFileSync(seen.picture, join(out, name));
}

describe(`${AC5} the real window, shown to you`, () => {
  it(`${AC5} screenshots of the real window with the hub not answering count and the not notified row, taken at the reference window, stay INCONCLUSIVE until a taste call on them is recorded`, async () => {
    const out = process.env.DA994_SCREENS ?? tempDir();
    mkdirSync(out, { recursive: true });
    const app = sha256File(await appBinary());
    const taste = JSON.parse(readFileSync(TASTE, 'utf8')) as Taste;
    const files = (): Record<string, string> => Object.fromEntries([...SHOTS, 'run.json'].filter((f) => existsSync(join(out, f))).map((f) => [f, sha256File(join(out, f))]));
    const run = join(out, 'run.json');
    const ran = existsSync(run) ? (JSON.parse(readFileSync(run, 'utf8')) as { app?: string }).app : undefined;
    if (!kept(taste, files(), ran, app)) {
      const down = await setUpWorld();
      await stopHub(down.hub);
      await shot(await open(down.home, 'allowed'), hubCountFailures, 'hub-not-answering.png', out);

      const up = await setUpWorld();
      const denied = await open(up.home, 'denied');
      await sleep(3000);
      const ask = await askedRow(up.hub, up.repo);
      await shot(denied, (s) => rowFailures(s, ask), 'not-notified-row.png', out);
      writeFileSync(run, `${JSON.stringify({ app, issue: 994 })}\n`);
    }
    const got = files();
    expect(Object.keys(got).sort(), `the run wrote every picture to ${out}`).toEqual([...SHOTS, 'run.json'].sort());
    console.log(`#994 pictures from this run in ${out}:\n${Object.entries(got).map(([f, h]) => `  ${f}  ${h}`).join('\n')}`);
    tasteCall(taste, got);
  }, 25 * 60_000);
});
