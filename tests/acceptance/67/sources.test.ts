// #67 AC4, AC5 and AC11's first half: the hub slot state-source@1. Each source here is a package registering through
// `deep.registerStateSource`, on a release so it runs in the hub, and the slot's kit runs at install; `runKit` holds the
// same fills directly, and the four state sources DeepBuild ships. The plants are the criteria's: a source that calls a
// change undoable when its undo fails on the fixture, and one whose read() keeps its first answer. Neither fill is the
// kit's own: fixtures/settings-source/source.mjs is the sound source with the one fault switched on.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runKit, slotKits, type SlotKit } from '../../../packages/conformance/src/index.ts';
import { AC4, AC5, AC7, AC11, REPO } from './hub.ts';
import { openWorld, pkg, tempDir, type World } from './host.ts';

const SLOT = 'state-source@1';
/** The surface this file defines (README): the new package and the extension host's new methods, reached lazily. */
const workspaces = (): Promise<typeof import('../../../packages/workspaces/src/index.ts')> => import(/* @vite-ignore */ new URL('../../../packages/workspaces/src/index.ts', import.meta.url).href);
const kit = (): SlotKit => {
  const found = slotKits().find((k) => k.slot === SLOT);
  if (!found) throw Error(`slotKits() ships no ${SLOT} kit`);
  return found;
};
type Planted = 'undo-fails' | 'first-read-kept' | undefined;
interface Settings { file: string; fixture: string; log: string; planted: Planted }
function settings(planted?: Planted): Settings {
  const dir = tempDir();
  const file = join(dir, 'settings.json');
  writeFileSync(file, JSON.stringify({ port: 80, archive: 'kept' }));
  const log = join(dir, 'undone.log');
  writeFileSync(log, '');
  return { file, fixture: join(dir, 'fixture.json'), log, planted };
}
/** The source as a state-source@1 fill, as a package's registration fills the slot. */
async function fill(s: Settings): Promise<Parameters<typeof runKit>[1]> {
  const url = new URL('./fixtures/settings-source/source.mjs', import.meta.url).href;
  const { settingsSource } = (await import(url)) as { settingsSource(s: Settings): Record<string, unknown> };
  return { slot: SLOT, revision: kit().revision, name: 'settings', ...settingsSource(s) };
}
const sourcePackage = (id: string, s: Settings): string => pkg('settings-source', join(tempDir(), 'pkg'), { id: `deepbuild/${id}` }, { 'source.json': JSON.stringify(s) });

const sound = settings();
const lying = settings('undo-fails');
const stale = settings('first-read-kept');
const packages = { sound: sourcePackage('settings-sound', sound), lying: sourcePackage('settings-lying', lying), stale: sourcePackage('settings-stale', stale) };
let shared: Promise<World> | undefined;
const world = (): Promise<World> => (shared ??= openWorld(Object.values(packages)));
/** The sound package, installed once. */
let install: ReturnType<World['host']['install']> | undefined;
const installSound = async (): ReturnType<World['host']['install']> => (install ??= (await world()).host.install({ from: packages.sound, builtBy: null }));
/** And loaded. */
let loaded: Promise<World> | undefined;
const live = (): Promise<World> => (loaded ??= (async () => {
  const w = await world();
  const installed = await installSound();
  await w.host.check(installed);
  const load = await w.host.load(installed);
  if (load.status !== 'loaded') throw Error(`the sound source must load: ${load.reason}`);
  return w;
})());

describe(`${AC5} a source registered through deep.registerStateSource passes state-source@1 at install; one whose undo fails is refused, naming the change`, () => {
  it(`${AC5} the sound source installs with the kit passed, after the kit undid the change it calls undoable on the fixture`, async () => {
    const installed = await installSound();
    expect(installed.kits, `the install ran ${SLOT}'s kit on what the package registers`).toContainEqual({ slot: SLOT, fill: 'settings', verdict: 'PASS' });
    const undone = readFileSync(sound.log, 'utf8').split('\n').filter(Boolean);
    expect(undone, 'the kit carried out the undo of the change the source calls undoable').toContain('set-port');
    expect(undone, 'and not of the one it says it can\'t undo').not.toContain('purge-archive');
    expect(JSON.parse(readFileSync(sound.file, 'utf8')), 'the kit worked on the fixture, never on the live settings').toEqual({ port: 80, archive: 'kept' });
  }, 120_000);

  it(`${AC5} the planted source that calls purging the archive undoable is refused at install, naming the change, and isn't installed`, async () => {
    const w = await world();
    await expect(w.host.install({ from: packages.lying, builtBy: null }), 'the refusal names the change').rejects.toThrow(/purge-archive/);
    expect((await w.host.installed()).map((p) => p.id), 'the refused package isn\'t installed').not.toContain('deepbuild/settings-lying');
  }, 120_000);

  it(`${AC5} runKit reads PASS on the sound fill and FAIL on the planted one, the failing case naming the change`, async () => {
    expect((await runKit(kit(), await fill(settings()))).verdict, 'the sound fill').toBe('PASS');
    const report = await runKit(kit(), await fill(settings('undo-fails')));
    expect(report.verdict, 'the planted fill').toBe('FAIL');
    expect(report.cases.filter((c) => c.outcome === 'FAIL').map((c) => c.message).join(' '), 'the failing case').toContain('purge-archive');
  }, 120_000);

  it(`${AC5} the four state sources DeepBuild ships first, git, a host's change log, an API snapshot and document versions, pass the kit`, async () => {
    const { shippedSources } = await workspaces();
    const fills = shippedSources();
    expect(fills.map((f) => f.name).sort()).toEqual(['api', 'document', 'git', 'host']);
    for (const f of fills) {
      const report = await runKit(kit(), f);
      expect([f.name, report.verdict, report.cases.filter((c) => c.outcome !== 'PASS').map((c) => c.message)]).toEqual([f.name, 'PASS', []]);
    }
  }, 120_000);
});

describe(`${AC11} a planted state source whose read() returns its first answer after the fixture setting changed fails state-source@1, naming the item`, () => {
  it(`${AC11} runKit reads FAIL on the source that keeps its first answer, the failing case naming the item`, async () => {
    const report = await runKit(kit(), await fill(settings('first-read-kept')));
    expect(report.verdict).toBe('FAIL');
    expect(report.cases.filter((c) => c.outcome === 'FAIL').map((c) => c.message).join(' '), 'the failing case names the setting that changed').toMatch(/\bport\b/);
  }, 120_000);

  it(`${AC11} registered through deep.registerStateSource, it is refused at install, naming the item`, async () => {
    const w = await world();
    await expect(w.host.install({ from: packages.stale, builtBy: null }), 'the refusal names the item').rejects.toThrow(/\bport\b/);
    expect((await w.host.installed()).map((p) => p.id)).not.toContain('deepbuild/settings-stale');
  }, 120_000);
});

describe(`${AC4} a change through a state source with no undo shows "can't undo" in its plan`, () => {
  const ask = (question: string) => ({
    kind: 'authority', question, options: [{ id: 'approve', label: 'Do it', decision: 'allow' }, { id: 'decline', label: 'Hold it', decision: 'deny' }], recommended: null,
    deadline: Date.now() + 86_400_000, fallback: 'you', default: 'decline', provisional: false, owner: 'you',
    subject: { effect: 'send', target: { kind: 'setting', ref: question, owner: 'you' }, change: null }, pinned_to: { kind: 'evidence', ref: 'e'.repeat(64) },
  });
  const core = { writer: 'core', actor: 'you', scope: 'you', session: 'S67', agent: 'claude-code' } as const;

  it(`${AC4} the plan of a change the source can't undo says so on the card you answer and in the record; one it can undo gives its undo`, async () => {
    const { changePlan } = await workspaces();
    const w = await live();
    const source = await w.host.stateSource('settings');
    const step = { does: 'Purge the archive', changes: ['archive'], public: false, cost: 0 };
    const purge = await changePlan(source, { id: 'purge-archive', item: 'archive', was: 'kept', to: 'purged' }, step);
    const purgeAsk = await w.asks.raise(core, 'effect.send', ask('Purge the archive?'), purge);
    expect((await w.asks.card(purgeAsk)).plan?.steps[0]?.undo, 'the card you answer').toBe("can't undo");
    const proposed = (await w.record.read({ after: 0, limit: 1000 })).filter((e) => e.kind === 'plan.proposed').at(-1)!;
    expect(JSON.stringify(proposed.data), 'the plan the record keeps').toContain("can't undo");

    const port = await changePlan(source, { id: 'set-port', item: 'port', was: 80, to: 8080 }, { does: 'Move the port', changes: ['port'], public: false, cost: 0 });
    const portAsk = await w.asks.raise(core, 'effect.send', ask('Move the port?'), port);
    expect((await w.asks.card(portAsk)).plan?.steps[0]?.undo, 'a change the source can undo gives its undo').toBe('Set port back to 80');
  }, 120_000);
});

describe(`${AC7} a workspace verdict's verdict.made key holds state_digests, and one without them fails its schema, naming the field`, () => {
  it(`${AC7} a verdict.made whose key has no state_digests fails its schema, naming the field`, async () => {
    const { validate } = await import('../../../packages/contracts/src/index.ts');
    const event = JSON.parse(readFileSync(join(REPO, 'packages/contracts/fixtures/verdict.made@1/01.json'), 'utf8')) as { data: { key: Record<string, unknown> } };
    expect(validate('verdict.made@1', event).ok, 'the fixture holds as it is').toBe(true);
    delete event.data.key.state_digests;
    const result = validate('verdict.made@1', event);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result), 'the refusal names the field').toContain('state_digests');
  });
});
