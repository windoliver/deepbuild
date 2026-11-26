// AC3 of #1828, written blind (README.md): on a hub started by `deep hub run`, an update that drops an interface an
// installed package uses raises one `extension.update` ask and installs nothing before your yes.
//
// The world: acme/acme 1.0.0 provides the reading ext.acme.prices@1, and acme/stocks uses it, both installed with
// `deep install` on the running hub. The update is acme/acme 2.0.0, which provides ext.acme.prices@2 only and keeps no
// adapter for @1 (design: Composition, Changes travel along edges: "a package that drops name@N without one installs
// only as a removal of a required use's provider, which asks you once, naming its users"). Its `deep install` runs in
// the background while the test reads the record and the inbox; your yes is `deep inbox answer`, on the trusted path
// once the (stubbed) OS confirms you.
//
// The record carries no ask's source, so the `extension.update` ask is known by that source's row in ask.sources@2: an
// authority ask, answered only on the trusted path, whose question names the update, the interface it drops and the
// piece that uses it, with an option that says yes and one that says no.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deep, deepStart, digestOf, events, installedVersions, makePackage, sleep, startHub, until, type Hub, type Line } from './helpers.ts';

const P1 = 'ext.acme.prices@1';
const P2 = 'ext.acme.prices@2';
const SHAPE1 = { type: 'object', properties: { symbol: { type: 'string' }, cents: { type: 'integer' } }, required: ['symbol', 'cents'], additionalProperties: false };
const SHAPE2 = { type: 'object', properties: { symbol: { type: 'string' }, price: { type: 'string' } }, required: ['symbol', 'price'], additionalProperties: false };
/** A provides row at minor 0 with its JSON Schema and the frozen digest it keeps for that minor (extension.compose@1). */
const row = (iface: string, schema: Record<string, unknown>) => ({ interface: iface, kind: 'reading', minor: 0, schema, digests: { 0: digestOf(schema) } });
const provider = (version: string, iface: string, schema: Record<string, unknown>, value: unknown) => makePackage({
  id: 'acme/acme', version,
  manifest: { requires: { preview: ['deep.provide'] }, provides: [row(iface, schema)] },
  index: `export default function (deep: any): void {\n  deep.provide('${iface}', 'reading', ${JSON.stringify(schema)}, async () => (${JSON.stringify(value)}));\n}\n`,
});
const stocks = () => makePackage({
  id: 'acme/stocks', version: '1.0.0',
  manifest: { requires: { preview: ['deep.use'] }, uses: [{ interface: P1, minor: 0, schema: SHAPE1, digest: digestOf(SHAPE1) }] },
  index: `export default function (deep: any): void {\n  deep.use('${P1}');\n}\n`,
});

/** The ask.created events of the update: each question that names acme/acme 2.0.0 and the interface it drops. */
const updateAsks = async (hub: Hub): Promise<Line[]> => (await events(hub))
  .filter((e) => e.kind === 'ask.created' && typeof e.data?.question === 'string' && e.data.question.includes('acme/acme') && e.data.question.includes('2.0.0') && e.data.question.includes(P1));
/** What the hub's extension host holds of acme/acme 2.0.0's bytes: its install folders under the hub's root. */
const v2Folders = (hub: Hub): string[] => {
  const dir = join(hub.root, 'extensions', 'acme', 'acme');
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith('2.0.0')) : [];
};

describe('AC3 #1828.44a54c78 on the same hub, an update that drops an interface an installed package uses raises one extension.update ask and installs nothing before your yes', () => {
  it('AC3 the update asks once, from extension.update, naming acme/stocks and ext.acme.prices@1; nothing is installed until your yes, and your yes installs it', async () => {
    const hub = await startHub();
    // The starting world, installed and loaded as you install a package: each `deep install` exits 0.
    for (const dir of [provider('1.0.0', P1, SHAPE1, { symbol: 'ACME', cents: 12345 }), stocks()]) {
      const r = await deep(hub.home, ['install', dir]);
      if (r.code !== 0) throw Error(`BLOCKED: the starting world: deep install ${dir} exited ${r.code}: ${r.stdout}${r.stderr}`);
    }
    expect(installedVersions(hub, 'acme/acme'), 'the starting world: acme/acme 1.0.0 is installed').toEqual(['1.0.0']);
    expect(installedVersions(hub, 'acme/stocks'), 'the starting world: acme/stocks is installed').toEqual(['1.0.0']);
    expect(await updateAsks(hub), 'the starting world asked nothing about the update').toHaveLength(0);

    // The update, which drops ext.acme.prices@1 and keeps no adapter for it.
    const update = provider('2.0.0', P2, SHAPE2, { symbol: 'ACME', price: '123.45' });
    const install = deepStart(hub.home, ['install', update], 900_000);
    // It asks, or it ends: an install that refuses, or installs, without asking ends before any ask shows.
    const asked = await until(async () => {
      const found = await updateAsks(hub);
      if (found.length) return found;
      if (install.ended) return [] as Line[];
      return undefined;
    }, 180_000);
    expect(asked?.length, `the update raises an ask before it installs anything; deep install of 2.0.0: ${install.output()}`).toBeGreaterThan(0);

    // Shown to you, and asked again by nothing: a while later still one ask, the install still waiting for you, and
    // none of 2.0.0 installed.
    const inbox = await deep(hub.home, ['inbox', '--json']);
    expect(inbox.code, `deep inbox --json: ${inbox.stderr}`).toBe(0);
    await sleep(5000);
    const asks = await updateAsks(hub);
    expect(asks, 'one ask, never the same question twice').toHaveLength(1);
    const ask = asks[0]!;
    const handle = `ask:${ask.id}`;
    expect(JSON.parse(inbox.stdout).rows.map((r: Line) => r.id), 'the ask needs you: deep inbox lists it').toContain(handle);
    // extension.update's row: an authority ask, on the trusted path, naming what it drops and who uses it.
    expect(ask.data.kind, 'an authority ask').toBe('authority');
    expect(ask.data.may_answer, 'answered only on the trusted path').toBe('trusted_path');
    expect(ask.data.question, 'it names the piece that uses the dropped interface').toContain('acme/stocks');
    const options = ask.data.options as { id: string; decision: string }[];
    const yes = options.find((o) => o.decision === 'allow');
    expect(yes, 'an option that says yes').toBeDefined();
    expect(options.some((o) => o.decision === 'deny'), 'an option that says no').toBe(true);
    expect(install.ended, `the install waits for your answer: ${install.output()}`).toBeUndefined();
    expect(installedVersions(hub, 'acme/acme'), 'nothing is installed before your yes: acme/acme stays at 1.0.0').toEqual(['1.0.0']);
    expect(v2Folders(hub), 'none of 2.0.0\'s bytes are copied in before your yes').toEqual([]);

    // Your yes, from your own terminal once the OS confirms you.
    const answered = await deep(hub.home, ['inbox', 'answer', handle, yes!.id]);
    expect(answered.code, `deep inbox answer ${handle} ${yes!.id}: ${answered.stdout}${answered.stderr}`).toBe(0);
    const ended = await install.done;
    expect(ended.code, `your yes lets the install finish: ${install.output()}`).toBe(0);
    expect(ended.stdout).toContain('Installed acme/acme@2.0.0');
    expect(installedVersions(hub, 'acme/acme'), 'acme/acme 2.0.0 is installed after your yes').toEqual(['2.0.0']);
    expect(await updateAsks(hub), 'still the one ask: your yes raised no other').toHaveLength(1);
    const answers = (await events(hub)).filter((e) => e.kind === 'ask.answered' && e.subject === handle);
    expect(answers.map((e) => e.data?.decision), 'the record holds your one yes to it').toEqual(['allow']);
  }, 1_200_000);
});
