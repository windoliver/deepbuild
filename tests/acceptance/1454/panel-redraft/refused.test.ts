// AC3 #1454.a94aca43, the refused panel, redrafted blind: a panel that fails its kit doesn't load, naming the kit.
//
// fixtures/refused really loads and draws its words when something mounts it (`--panel`, below, and app/refused.rs with no
// window), and `panel@1` refuses it. So those words missing from the window mean the kit kept it out, and a program that
// mounts every installed panel shows them. The window is read by its pixels, as words; a panel's nodes aren't on the
// accessibility tree.
import { cpSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { packageDigest } from '../../../../packages/extension-host/src/index.ts';
import { App, appBinary, blocked, install, MINUTES, ocr, panelFailures, reads, REFUSED_TEXT, sees, sessionWorld, settled, sleep, t26, t806, useCleanup, type Feature } from '../helpers.ts';

useCleanup();

const FIXTURE = fileURLToPath(new URL('./fixtures/refused', import.meta.url));
/** How long a window that shows no refused panel is read for. A panel that mounts late is mounted. */
const WATCH_MS = 15_000;

/** The fixture as a package in a temp folder, its `.fixture` named and its digest set, as helpers.ts's `packageDir` does its own. */
function refusedPackage(): string {
  const dir = join(t806.tempDir(), 'refused');
  cpSync(FIXTURE, dir, { recursive: true });
  renameSync(join(dir, 'index.ts.fixture'), join(dir, 'index.ts'));
  const file = join(dir, 'deepbuild.json');
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  manifest.digest = packageDigest(dir);
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}

/** `deep install` of the fixture. A package that dies before it connects says nothing about its kit (../README, How to run: Node). */
async function installRefused(home: string): Promise<t26.Ran> {
  const ran = await t26.deep(home, ['install', refusedPackage()]);
  if (/platform sandbox: it exited \(SIG/.test(ran.stderr)) blocked(`this Mac can't run a sandboxed package, so no package can reach its kit: ${ran.stderr.trim().slice(-200)}`);
  return ran;
}

/** What's wrong with the window holding no refused panel, read for `WATCH_MS`, once `drawn` finds nothing wrong. */
async function neverDrawn(app: App, drawn: () => Promise<string[]> = async () => []): Promise<string[]> {
  const first = await settled(drawn, 60_000);
  if (first.length) return first;
  for (const until = Date.now() + WATCH_MS; ;) {
    const lines = await ocr(await app.capture('refused'));
    if (reads(lines, REFUSED_TEXT)) return [`the panel that failed panel@1 was loaded anyway: the window draws "${REFUSED_TEXT}": ${sees(lines)}`];
    if (Date.now() > until) return [];
    await sleep(300);
  }
}

/**
 * The refused panel installed, on a real hub, and the app run with no argument: alone first, so it has the sidebar to itself
 * and nothing it could lose a slot to; then in the same home with a panel that passes, whose words show that this window
 * draws what's installed. What each window got wrong.
 */
async function bothWindows(plant?: Feature): Promise<string[]> {
  const world = await sessionWorld();
  const binary = await appBinary(...(plant ? [plant] : []));
  await installRefused(world.home);
  const alone = await App.launch({ home: world.home, binary });
  const inAlone = await neverDrawn(alone).finally(() => alone.stop());
  const good = await install(world.home, 'board');
  expect(good.code, `deep install of the panel that passes its kit: ${good.stdout}${good.stderr}`).toBe(0);
  const beside = await App.launch({ home: world.home, binary });
  const inBeside = await neverDrawn(beside, async () => panelFailures(await ocr(await beside.capture('panels')), { refused: false })).finally(() => beside.stop());
  return [...inAlone, ...inBeside];
}

describe('#1454 a panel that fails its kit, redrafted', () => {
  it('AC3 #1454.a94aca43 `deep install` of a panel that fails panel@1 says it isn\'t loaded, naming the kit', async () => {
    const world = await sessionWorld();
    const refused = await installRefused(world.home);
    const said = `${refused.stdout}${refused.stderr}`;
    expect(refused.code, `deep install says the refused panel isn't loaded, by its exit code: ${said}`).not.toBe(0);
    expect(said, 'deep install names the kit the panel failed').toContain('panel@1');
  }, 10 * MINUTES);

  it('AC3 #1454.a94aca43 a panel that fails its kit doesn\'t load: installed, it is in no window, alone or beside a panel that draws', async () => {
    expect(await bothWindows()).toEqual([]);
  }, 10 * MINUTES);

  it('AC3 #1454.a94aca43 the refused panel is real: mounted by `deep-app --panel`, past any kit, it loads and draws its words', async () => {
    const world = await sessionWorld();
    const app = await App.launch({ home: world.home, binary: await appBinary(), args: ['--panel', join(refusedPackage(), 'panel')] });
    try {
      const failures = await settled(async () => {
        const lines = await ocr(await app.capture('mounted'));
        return reads(lines, REFUSED_TEXT) ? [] : [`mounted, the panel draws no "${REFUSED_TEXT}": the window reads ${sees(lines)}`];
      }, 20_000);
      expect(failures).toEqual([]);
    } finally {
      await app.stop();
    }
  }, 10 * MINUTES);

  it('AC3 #1454.a94aca43 wrong program: an app that mounts every installed panel, kit or no kit, fails, naming the panel', async () => {
    const failures = await bothWindows('plant-panel-skips-kit');
    expect(failures.join('\n')).toContain(`the panel that failed panel@1 was loaded anyway: the window draws "${REFUSED_TEXT}"`);
  }, 10 * MINUTES);
});
