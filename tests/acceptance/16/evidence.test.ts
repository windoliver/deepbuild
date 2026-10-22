// #16 AC20, AC21 and AC22: the hub owns the evidence store (#15). Each connection writes through a writer
// bound to its role, so origin comes from the credential; a run's text evidence is scrubbed of the values the
// hub injected and the env it passed; the retention pass keeps what the record cites. The tests read the store
// through @deepbuild/evidence at <root>/evidence and the record through @deepbuild/record at <root>/ledger.db,
// as #15 and #14 published them (README, Files the tests read).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { fixtures } from '../../../packages/contracts/src/index.ts';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import {
  Agent, allEvents, ALNUM, cleanup, COMMIT, control, DAY, establish, evidenceFile, FIXTURES, formsIn, installedRoot, makeHome, mulberry32,
  newSession, NODE, png, result, SEED, sha256, startHub, stopHub, tempDir, ulid, waitFor, word, type Hub, type Line,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const originOf = async (root: string, hash: string) => (await (await openEvidenceStore({ root: join(root, 'evidence') })).get(hash))?.origin;

describe('AC20 #16.769081da origin comes from the credential: deep_evidence stores origin agent, the app\'s paste origin you', () => {
  interface Origins { file: { name: string; sha: string; bytes: string; origin?: string }; paste: { sha: string; bytes: string; origin?: string } }
  async function stored(plant?: string): Promise<Origins> {
    const home = makeHome();
    const hub = await startHub({ home, ...(plant && { plant }) });
    const A = newSession(home, 'claude-code');
    const P = Agent.start(home, A.cwd);
    await establish(P, hub.socket, A);
    const hello = await P.mcpOpen(hub.socket);
    if (hello.role !== `mcp:${A.id}`) throw Error(`BLOCKED: deep mcp for session A wasn't bound to it: ${JSON.stringify(hello)}`);
    const shot = png(16, 16, 2001);
    writeFileSync(join(A.cwd, 'shot.png'), shot);
    const r1 = result(await P.mcp('mcp.call', { tool: 'deep_evidence', arguments: { path: 'shot.png', kind: 'screenshot', origin: 'deepbuild' } }));
    const pasted = png(16, 16, 2002);
    const app = await control(hub, 'app');
    const r2 = result(await app.call('evidence.paste', { bytes: Buffer.from(pasted).toString('base64'), type: 'png', origin: 'deepbuild' }));
    app.close();
    await P.stop();
    await stopHub(hub);
    const file = { name: 'shot.png', sha: r1.sha256 as string, bytes: sha256(shot) };
    const paste = { sha: r2.sha256 as string, bytes: sha256(pasted) };
    const fo = await originOf(hub.root, file.sha);
    const po = await originOf(hub.root, paste.sha);
    return { file: { ...file, ...(fo && { origin: fo }) }, paste: { ...paste, ...(po && { origin: po }) } };
  }
  function fromCredential(o: Origins): void {
    expect(o.file.sha, 'deep_evidence returns the file\'s hash').toBe(o.file.bytes);
    expect(o.paste.sha, 'the paste returns its hash').toBe(o.paste.bytes);
    expect(o.file.origin, `the file ${o.file.name} (${o.file.sha}) from session A's deep_evidence must be stored with origin agent`).toBe('agent');
    expect(o.paste.origin, `the image pasted through the app (${o.paste.sha}) must be stored with origin you`).toBe('you');
  }
  it('AC20 a deep_evidence payload saying origin deepbuild stores origin agent; a paste through the app stores origin you', async () => {
    fromCredential(await stored());
  }, 90_000);
  it('AC20 (wrong program) a hub that passes the payload\'s origin to the store fails, naming the file', async () => {
    const o = await stored('origin-from-payload');
    expect(() => fromCredential(o)).toThrow(/shot\.png/);
  }, 90_000);
  it('AC20 whatever origin the payload names, or none, the store takes it from the credential (40 cases, seed 16)', async () => {
    const home = makeHome();
    const hub = await startHub({ home });
    const A = newSession(home, 'claude-code');
    const P = Agent.start(home, A.cwd);
    await establish(P, hub.socket, A);
    await P.mcpOpen(hub.socket);
    const app = await control(hub, 'app');
    const made: { sha: string; want: string }[] = [];
    let n = 0;
    await fc.assert(fc.asyncProperty(fc.constantFrom<string | undefined>('deepbuild', 'you', 'agent', undefined, 'root', ''), async (origin) => {
      const i = ++n;
      const name = `f${i}.png`;
      writeFileSync(join(A.cwd, name), png(8, 8, 5000 + i));
      const r1 = result(await P.mcp('mcp.call', { tool: 'deep_evidence', arguments: { path: name, kind: 'screenshot', ...(origin !== undefined && { origin }) } }));
      made.push({ sha: r1.sha256 as string, want: 'agent' });
      const r2 = result(await app.call('evidence.paste', { bytes: Buffer.from(png(8, 8, 9000 + i)).toString('base64'), type: 'png', ...(origin !== undefined && { origin }) }));
      made.push({ sha: r2.sha256 as string, want: 'you' });
    }), { seed: SEED, numRuns: 40 });
    app.close();
    await P.stop();
    await stopHub(hub);
    for (const { sha, want } of made) expect(await originOf(hub.root, sha), `${sha} is stored with origin ${want}`).toBe(want);
  }, 180_000);
});

describe('AC21 #16.dfe5f026 a run\'s output is stored with neither its injected token nor its BUILD_ID in any form', () => {
  interface Stored { run: string; values: Record<string, string>; texts: string[] }
  async function runOutput(plant?: string, seed = SEED): Promise<Stored> {
    const home = makeHome();
    const hub = await startHub({ home, ...(plant && { plant }) });
    const side = join(tempDir(), 'values.json');
    const buildId = word(mulberry32(seed), 24, ALNUM);
    const cli = await control(hub);
    const started = result(await cli.call('run.start', { check: 'check:print-env', claim: `claim:${ulid()}`, commit: COMMIT, argv: [NODE, join(FIXTURES, 'print-env.mjs'), side], env: { BUILD_ID: buildId } }));
    const run = started.run as string;
    const finished = await waitFor(async () => (await allEvents(cli)).find((e) => e.kind === 'run.finished' && e.data.run === run), 30_000, `run.finished for ${run}`);
    cli.close();
    await stopHub(hub);
    const values = JSON.parse(readFileSync(side, 'utf8')) as Record<string, string>;
    const texts = (finished.data.evidence as string[]).map((hash) => (existsSync(evidenceFile(hub.root, hash)) ? readFileSync(evidenceFile(hub.root, hash), 'utf8') : ''));
    return { run, values, texts };
  }
  function scrubbed(o: Stored): void {
    expect(o.values.BUILD_ID, 'the run saw the BUILD_ID it was given').toHaveLength(24);
    expect(o.values.DEEP_RUN_TOKEN?.length ?? 0, `the hub injected a run token (DEEP_RUN_TOKEN) into run ${o.run}`).toBeGreaterThanOrEqual(16);
    expect(o.texts.join('\n'), `run ${o.run}'s output is stored as evidence`).toContain('print-env: done');
    expect(formsIn(o.texts.join('\n'), o.values), `run ${o.run} stored a form of a value it must scrub`).toEqual([]);
  }
  it('AC21 a run with an injected token and a 24-character BUILD_ID stores its output with neither, raw, URL-encoded or base64 at any offset', async () => {
    scrubbed(await runOutput());
    scrubbed(await runOutput(undefined, SEED + 1));
  }, 120_000);
  it('AC21 (wrong program) a hub that hands the store no run values stores both and fails, naming the run', async () => {
    const o = await runOutput('no-run-values');
    expect(() => scrubbed(o)).toThrow(new RegExp(`run ${o.run}`));
  }, 120_000);
});

describe('AC22 #16.6e2b63bc on a test clock, the retention pass on day 31 keeps what the record cites and removes the rest', () => {
  const DAY0 = Date.UTC(2026, 9, 1, 12, 0, 0);
  interface Kept { cited: string; archived: string; uncited: string; present: Record<string, boolean>; removedSeen: boolean }
  async function retention(plant?: string): Promise<Kept> {
    const home = makeHome();
    const root = installedRoot(home);
    // Day 0: three files in the store, one cited by a decision and one linked by transcript.archived, in the record.
    const store = await openEvidenceStore({ root: join(root, 'evidence'), now: () => DAY0 });
    const writer = store.connect({ role: 'deepbuild', via: 'job' });
    const put = async (text: string) => {
      const r = await writer.put({ bytes: new Uint8Array(Buffer.from(text)), kind: 'log', source: 'test', redaction: 'complete', license: { name: 'CC0-1.0', allows: [] } });
      if (r.status !== 'stored') throw Error(`BLOCKED: the store refused a day-0 file: ${r.reason}`);
      return r.evidence.sha256;
    };
    const cited = await put('the decision\'s baseline, cited\n');
    const archived = await put('an archived transcript, linked\n');
    const uncited = await put('a log nobody cites\n');
    const record = await openRecord({ path: join(root, 'ledger.db'), now: () => DAY0 });
    const core = { writer: 'core', actor: 'you', scope: 'you' };
    const decision = fixtures('decision.created@1')[0] as Line;
    await record.append(core, { v: 1, id: ulid(DAY0), kind: 'decision.created', ts: DAY0, data: decision.data, evidence: [cited] });
    await record.append(core, { v: 1, id: ulid(DAY0), kind: 'transcript.archived', ts: DAY0, data: { session: `session:${ulid(DAY0)}`, evidence: archived } });
    await record.close();
    // Day 31: the hub starts on the test clock and runs the pass at start.
    const hub: Hub = await startHub({ home, clock: DAY0 + 31 * DAY, ...(plant && { plant }) });
    const removedSeen = await waitFor(() => !existsSync(evidenceFile(root, uncited)) || undefined, 15_000, `the uncited day-0 file ${uncited} to be removed on day 31`).then(() => true, () => false);
    await stopHub(hub);
    const present = Object.fromEntries([cited, archived, uncited].map((h) => [h, existsSync(evidenceFile(root, h))]));
    return { cited, archived, uncited, present, removedSeen };
  }
  function keepsCited(o: Kept): void {
    expect(o.removedSeen && !o.present[o.uncited], `the uncited day-0 file ${o.uncited} is removed on day 31`).toBe(true);
    expect(o.present[o.cited], `the file a decision cites, ${o.cited}, must be kept`).toBe(true);
    expect(o.present[o.archived], `the transcript a transcript.archived event links, ${o.archived}, must be kept`).toBe(true);
  }
  it('AC22 day 31 removes an uncited day-0 file and keeps a decision\'s file and an archived transcript', async () => {
    keepsCited(await retention());
  }, 90_000);
  it('AC22 (wrong program) a hub that hands the pass an empty set of cited hashes removes the decision\'s file and fails, naming its hash', async () => {
    const o = await retention('empty-cited');
    expect(() => keepsCited(o)).toThrow(new RegExp(o.cited));
  }, 90_000);
});

