// #996 AC2: the hosted terminals index (`<root>/extensions/terminals.json`) with one bad byte in one entry of three.
// The seed is made with the hub stopped, through the record, supervisor and extension host the hub opens on its root
// (README, AC2's seed): the fixture piece installed with run-as-you approved, three terminals each held by a host
// process the supervisor keeps past the hub, and the index as the extension host writes it; then one raw control byte
// goes into the third entry's title.
//
// - The hub: `deep hub run --root` on that root starts and answers on its socket, keeps the damaged index aside byte
//   for byte under a name with its time, records one reading naming terminals.json and the terminal it lost, and the
//   two readable terminals' programs run on.
// - Their sessions: the extension host as the hub opens it, on the same files, starts; the piece's terminal tabs
//   (`deep.terminal.list()`) show the two readable terminals reattached (same terminal, run and PID, output read from
//   the first byte with no gap) and the third as lost, never left out as a closed one would be.
// - (control) With no bad byte, all three reattach: the seed is one the base reattaches, so the failures above are the
//   bad byte's.
// At the base the extension host throws on the damaged index, so the hub doesn't start and no terminal reattaches.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ExtensionHost, Installed } from '../../../packages/extension-host/src/index.ts';
import {
  act, alive, beats, Client, damage, fixturePackage, indexText, installAndLoad, keptAside, message, openHostOn, openWorld, readingsNaming, seedTerminal,
  sleep, stopHub, tempDir, tryHub, waitFor, type Line, type Seeded, type World,
} from './helpers.ts';

interface Seed { root: string; terminals: Seeded[]; index: string; written: Buffer }

/** Three kept terminals of the fixture piece on a fresh hub root, the hub stopped; the third entry damaged unless `intact`. */
async function seed(intact = false): Promise<Seed> {
  const root = join(tempDir(), 'root');
  const w = await openWorld(root);
  const terminals: Seeded[] = [];
  try {
    const h = await openHostOn(w);
    let p: Installed;
    try {
      p = await installAndLoad(h, await fixturePackage());
    } finally {
      await h.close();
    }
    for (const title of ['alpha', 'bravo', 'charlie']) terminals.push(await seedTerminal(w, p.id, title));
  } finally {
    await w.close();
  }
  const index = join(root, 'extensions', 'terminals.json');
  mkdirSync(join(root, 'extensions'), { recursive: true });
  const text = indexText(terminals);
  const written = intact ? Buffer.from(text, 'utf8') : damage(text, terminals[2]!);
  writeFileSync(index, written);
  // The terminals ran on past the seed's close, as kept ones do.
  for (const t of terminals) if (!alive(t.pid)) throw Error(`BLOCKED: ${t.title}'s program (PID ${t.pid}) didn't outlive the seed's supervisor`);
  return { root, terminals, index, written };
}

const outSize = (t: Seeded): number => (existsSync(join(t.dir, 'out')) ? statSync(join(t.dir, 'out')).size : 0);
const readsLost = (tab: Line): boolean => tab.lost === true || tab.status === 'lost' || tab.state === 'lost';
const readsClosed = (tab: Line): boolean => tab.closed === true || tab.status === 'closed' || tab.state === 'closed';

/** Every entry the piece's tabs action gives (deep.terminal.list(), passed through whole). */
async function tabsOf(h: ExtensionHost, p: Installed): Promise<Line[]> {
  const tabs = (await act(h, p, 'ext.hosted-terminals.tabs', {})).tabs;
  if (!Array.isArray(tabs)) throw Error(`the piece's tabs action answered no list: ${JSON.stringify(tabs)}`);
  return tabs as Line[];
}
/** Everything a terminal's program wrote, read through the piece from byte 0. */
async function outputOf(h: ExtensionHost, p: Installed, terminal: string): Promise<{ text: string; refused?: string }> {
  let text = '';
  for (let from = 0, i = 0; i < 1000; i++) {
    const r = await act(h, p, 'ext.hosted-terminals.read', { terminal, from });
    if (typeof r.refused === 'string') return { text, refused: r.refused };
    text += String(r.text ?? '');
    const next = Number(r.next);
    if (!Number.isSafeInteger(next) || next <= from) break;
    from = next;
  }
  return { text };
}
/** A reattached terminal: listed with the terminal, run and PID it had, its output read from beat 1 with no gap, and growing. */
async function reattachProblems(h: ExtensionHost, p: Installed, tabs: Line[], t: Seeded): Promise<string[]> {
  const tab = tabs.find((x) => x.terminal === t.terminal);
  if (!tab) return [`${t.title} (${t.terminal}) isn't among the piece's tabs, so it didn't reattach: ${JSON.stringify(tabs).slice(0, 400)}`];
  const out: string[] = [];
  if (tab.run !== t.run || tab.pid !== t.pid) out.push(`${t.title}'s tab names run ${String(tab.run)} and PID ${String(tab.pid)}, not the ${t.run} and ${t.pid} it had`);
  if (readsLost(tab)) out.push(`${t.title}, whose entry is whole, reads lost: ${JSON.stringify(tab)}`);
  const first = await outputOf(h, p, t.terminal);
  if (first.refused) return [...out, `${t.title}'s output can't be read: ${first.refused}`];
  const seen = beats(first.text);
  if (!seen.length || seen.some((b, i) => b !== i + 1)) out.push(`${t.title}'s output doesn't read from beat 1 with no gap: ${seen.slice(0, 10).join(', ')}${seen.length > 10 ? ', …' : ''}`);
  await sleep(1000);
  const later = beats((await outputOf(h, p, t.terminal)).text);
  if (later.length <= seen.length) out.push(`${t.title}'s program stopped writing: ${seen.length} beats, then ${later.length} a second later`);
  return out;
}

/** The extension host as the hub opens it on the seed's root, with each installed piece loaded again; or why it didn't start. */
async function reopen(s: Seed): Promise<{ w: World; h?: ExtensionHost; p?: Installed; failed?: string }> {
  const w = await openWorld(s.root);
  let h: ExtensionHost;
  try {
    h = await openHostOn(w);
  } catch (e) {
    return { w, failed: message(e) };
  }
  const [p] = (await h.installed()).filter((x) => x.id === s.terminals[0]!.id);
  if (!p) return { w, h, failed: `the piece ${s.terminals[0]!.id} isn't installed any more` };
  if (!h.checked(p)) await h.check(p);
  const load = await h.load(p);
  if (load.status !== 'loaded') return { w, h, failed: `the piece ${p.id} didn't load again: ${load.reason}` };
  return { w, h, p };
}

describe('AC2 #996.17155b2f with terminals.json holding one entry with a bad byte among three, the hub starts, two terminals reattach and the third reads lost on its session', () => {
  it('AC2 the hub starts on the damaged index: it answers on its socket, keeps the index aside byte for byte under a name with its time, records one reading naming terminals.json and the lost terminal, and the two readable terminals run on', async () => {
    const s = await seed();
    const [alpha, bravo, charlie] = s.terminals as [Seeded, Seeded, Seeded];
    const { hub, failed } = await tryHub(s.root);
    if (!hub) throw Error(`the hub didn't start on a terminals.json holding one entry with a bad byte among three, so no terminal reattached: ${failed}`);
    const problems: string[] = [];
    try {
      const client = await Client.open(hub);
      const health = await client.call('hub.health').catch((e: unknown) => ({ refused: message(e) }));
      if ('refused' in health) problems.push(`the started hub doesn't answer hub.health: ${String(health.refused)}`);
      const folder = join(s.root, 'extensions');
      const aside = await waitFor(() => { const k = keptAside(folder, 'terminals.json', s.written); return k.found ? k : undefined; }, 10_000, 'the damaged index kept aside').catch(() => keptAside(folder, 'terminals.json', s.written));
      if (!aside.found) problems.push(`the damaged index isn't kept aside: ${aside.problem}`);
      const readings = await waitFor(async () => { const r = readingsNaming(await client.events(), 'terminals.json'); return r.length ? r : undefined; }, 10_000, 'a reading naming terminals.json').catch(() => [] as Line[]);
      if (readings.length !== 1) problems.push(`the hub recorded ${readings.length} readings naming terminals.json, not one: ${JSON.stringify(readings.map((e) => ({ kind: e.kind, data: e.data }))).slice(0, 600)}`);
      else if (!JSON.stringify(readings[0]!.data).includes(charlie.terminal)) problems.push(`the reading naming terminals.json doesn't name the terminal it lost, ${charlie.terminal}: ${JSON.stringify(readings[0]!.data).slice(0, 400)}`);
      client.close();
      const sizes = [alpha, bravo].map(outSize);
      await sleep(1500);
      for (const [i, t] of [alpha, bravo].entries()) {
        if (!alive(t.pid)) problems.push(`${t.title}'s program (PID ${t.pid}), whose entry is whole, was stopped by the hub's start`);
        else if (outSize(t) <= sizes[i]!) problems.push(`${t.title}'s program stopped writing after the hub started`);
      }
    } finally {
      await stopHub(hub);
    }
    expect(problems, `the hub on a terminals.json with a bad byte in ${charlie.title}'s entry:\n${problems.join('\n')}`).toEqual([]);
  }, 180_000);

  it('AC2 on their sessions: the extension host the hub opens starts on the damaged index; the piece\'s tabs show the two readable terminals reattached, reading on from their first byte, and the third as lost, never as closed', async () => {
    const s = await seed();
    const [alpha, bravo, charlie] = s.terminals as [Seeded, Seeded, Seeded];
    const { w, h, p, failed } = await reopen(s);
    try {
      if (!h || !p) throw Error(`the extension host the hub opens didn't start on a terminals.json holding one entry with a bad byte among three, so none of the three terminals reattached: ${failed}`);
      const tabs = await tabsOf(h, p);
      const problems: string[] = [];
      for (const t of [alpha, bravo]) problems.push(...await reattachProblems(h, p, tabs, t));
      const lost = tabs.find((x) => x.terminal === charlie.terminal);
      if (!lost) problems.push(`${charlie.title} (${charlie.terminal}), whose entry has the bad byte, isn't among the piece's tabs at all, as a closed terminal would be: it must read lost; tabs: ${JSON.stringify(tabs).slice(0, 400)}`);
      else if (!readsLost(lost) || readsClosed(lost)) problems.push(`${charlie.title}'s tab doesn't read lost: ${JSON.stringify(lost)}`);
      expect(problems, `the piece's terminal tabs after a start on the damaged index:\n${problems.join('\n')}`).toEqual([]);
    } finally {
      await h?.close().catch(() => undefined);
      await w.close();
    }
  }, 180_000);

  it('AC2 (control) with no bad byte, the same seed reattaches all three: the extension host the hub opens lists them and reads each from its first byte', async () => {
    const s = await seed(true);
    expect(JSON.parse(readFileSync(s.index, 'utf8')), 'the control index is whole').toBeTypeOf('object');
    const { w, h, p, failed } = await reopen(s);
    try {
      if (!h || !p) throw Error(`BLOCKED: the extension host didn't start on a whole index: ${failed}`);
      const tabs = await tabsOf(h, p);
      const problems: string[] = [];
      for (const t of s.terminals) problems.push(...await reattachProblems(h, p, tabs, t));
      expect(problems, `the piece's terminal tabs on a whole index:\n${problems.join('\n')}`).toEqual([]);
    } finally {
      await h?.close().catch(() => undefined);
      await w.close();
    }
  }, 180_000);
});
